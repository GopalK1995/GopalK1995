// Send pipeline. Gate order, each failing CLOSED and recorded (never silently dropped):
//   sender identity -> recipient address -> can_contact(marketing_email) -> suppression list -> merge fields -> unsubscribe link
//   -> size -> throttle -> transport (idempotency key) -> record.
// Consent is re-checked here for EVERY send, including a message that was queued earlier: a withdrawal that arrived afterwards wins.
// A throw from the consent check propagates (the job retries, nothing is sent).
import { CredentialError, TransientError, type ConnectionRow } from "../core/types";
import { DISPATCH_BATCH, MAX_BODY_BYTES, MAX_SUBJECT, SEND_PER_MINUTE } from "./constants";
import { senderOf } from "./config";
import { escapeHtml, htmlToText, renderMerge, type MergeData } from "./merge";
import { isEmail } from "./mime";
import { normaliseEmail } from "./suppression";
import type { EmailDeps, OutboundRow, Recipient } from "./store";
import { EmailApiError, isRecipientRefusal, type EmailTransport } from "./transport";
import { signUnsubscribe, unsubscribeOneClickUrl, unsubscribePageUrl } from "./unsubscribe";

export type BlockReason = "no_sender" | "no_recipient" | "no_consent" | "suppressed" | "merge_missing" | "no_subject" | "too_large" | "no_unsubscribe" | "no_lead";
export type SendOutcome =
  | { kind: "sent"; providerId: string }
  | { kind: "blocked"; reason: BlockReason; missing?: string[] }
  | { kind: "failed"; failure: string }
  | { kind: "retry"; why: "throttled" | "transient"; retryAfterMs?: number };

export interface Composition { subject: string; text: string; html?: string }
export interface SendRequest {
  leadId: string;
  /** Subject and body, possibly with {{merge}} fields (rendered per recipient when `merge` is true). */
  subject: string; body: string; bodyIsHtml?: boolean; merge: boolean; extra?: MergeData;
  /** Stable per logical message: the provider de-duplicates retries on it. */
  idempotencyKey: string;
  /** Set when the message already exists as a queued row (inbox send). */
  messageId?: string | null;
}

const PARAGRAPHS = (t: string) => t.split(/\n{2,}/).map((p) => `<p style="margin:0 0 1em">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
const looksHtml = (s: string) => /<(p|br|div|table|a|h[1-6]|ul|ol|span)\b/i.test(s);

/** Renders subject and body for one recipient and appends the tenant footer and the unsubscribe line. Pure. */
export function compose(i: { subject: string; body: string; bodyIsHtml?: boolean; merge: boolean; recipient: Recipient; senderName: string | null; footer: string | null; unsubscribeUrl: string; extra?: MergeData }): { ok: true; value: Composition } | { ok: false; missing: string[] } {
  const data: MergeData = { first_name: i.recipient.firstName, name: i.recipient.fullName, company: i.recipient.company, district: i.recipient.district, sender_name: i.senderName, unsubscribe_url: i.unsubscribeUrl, ...i.extra };
  const html = i.bodyIsHtml ?? looksHtml(i.body);
  let subject = i.subject, body = i.body;
  const missing = new Set<string>();
  if (i.merge) {
    const s = renderMerge(i.subject, data, "text"); subject = s.text; s.missing.forEach((m) => missing.add(m));
    const b = renderMerge(i.body, data, html ? "html" : "text"); body = b.text; b.missing.forEach((m) => missing.add(m));
  }
  if (missing.size) return { ok: false, missing: [...missing] };
  const footerText = i.footer ? `${i.footer}\n` : "";
  const unsubLine = `Unsubscribe: ${i.unsubscribeUrl}`;
  const text = `${html ? htmlToText(body) : body}\n\n--\n${footerText}${unsubLine}`;
  const htmlOut = `${html ? body : PARAGRAPHS(body)}<hr style="border:none;border-top:1px solid #ddd;margin:1.5em 0"><p style="font-size:12px;color:#666">${i.footer ? `${escapeHtml(i.footer).replace(/\n/g, "<br>")}<br>` : ""}<a href="${escapeHtml(i.unsubscribeUrl)}">Unsubscribe</a></p>`;
  return { ok: true, value: { subject: subject.replace(/[\r\n]+/g, " ").trim(), text, html: htmlOut } };
}

/** Mail-safe tag value: letters, digits, underscore and hyphen. */
const tagValue = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

export async function sendEmail(d: EmailDeps, conn: ConnectionRow, transport: EmailTransport, req: SendRequest): Promise<SendOutcome> {
  const sender = senderOf(conn.settings);
  if (!sender.fromEmail || !isEmail(sender.fromEmail)) return { kind: "blocked", reason: "no_sender" };
  if (!req.leadId) return { kind: "blocked", reason: "no_lead" };
  const rcpt = await d.store.getRecipient(conn.workspaceId, req.leadId);
  if (!rcpt?.email || !isEmail(rcpt.email.trim())) return { kind: "blocked", reason: "no_recipient" };
  const to = rcpt.email.trim();
  // Consent first, suppression second; both fail closed (a throw propagates).
  if (!(await d.store.canContact(req.leadId))) return { kind: "blocked", reason: "no_consent" };
  if (await d.store.isSuppressed(conn.workspaceId, normaliseEmail(to))) return { kind: "blocked", reason: "suppressed" };
  if (!d.baseUrl || !d.unsubscribeSecret) return { kind: "blocked", reason: "no_unsubscribe" };   // never send mail that cannot be opted out of

  const token = signUnsubscribe({ t: conn.tenantId, w: conn.workspaceId, c: conn.id, l: req.leadId, s: null }, d.unsubscribeSecret, d.now().getTime());
  const pageUrl = unsubscribePageUrl(d.baseUrl, token), oneClick = unsubscribeOneClickUrl(d.baseUrl, token);
  const c = compose({ subject: req.subject, body: req.body, bodyIsHtml: req.bodyIsHtml, merge: req.merge, recipient: rcpt, senderName: sender.fromName, footer: sender.footer, unsubscribeUrl: pageUrl, extra: req.extra });
  if (!c.ok) return { kind: "blocked", reason: "merge_missing", missing: c.missing };
  if (!c.value.subject) return { kind: "blocked", reason: "no_subject" };
  if (c.value.subject.length > MAX_SUBJECT || Buffer.byteLength(c.value.html ?? c.value.text) > MAX_BODY_BYTES) return { kind: "blocked", reason: "too_large" };

  if (!(await d.rate(`email-send:${conn.id}`, SEND_PER_MINUTE, 60_000))) return { kind: "retry", why: "throttled", retryAfterMs: 5_000 };
  try {
    const r = await transport.send({
      from: { email: sender.fromEmail, name: sender.fromName ?? undefined }, to: { email: to, name: rcpt.fullName || undefined },
      replyTo: sender.replyTo && isEmail(sender.replyTo) ? { email: sender.replyTo } : undefined,
      subject: c.value.subject, text: c.value.text, html: c.value.html,
      headers: { "List-Unsubscribe": `<${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: { crm_conn: tagValue(conn.id), ...(req.messageId ? { crm_msg: tagValue(req.messageId) } : {}) },
      idempotencyKey: req.idempotencyKey,
    });
    return { kind: "sent", providerId: r.providerId };
  } catch (e) {
    if (e instanceof CredentialError) throw e;   // the whole connection needs attention
    if (e instanceof TransientError) return { kind: "retry", why: "transient", retryAfterMs: e.retryAfterMs };
    if (e instanceof EmailApiError) {
      if (e.transient) return { kind: "retry", why: "transient" };
      if (isRecipientRefusal(e)) {
        // The provider says this address cannot receive mail: that is a hard bounce, remember it so we never try again.
        await d.store.addSuppression({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, email: normaliseEmail(to), reason: "hard_bounce", source: "provider_refusal", leadId: req.leadId });
      }
      return { kind: "failed", failure: e.failure };
    }
    throw e;
  }
}

/** Dispatches one queued inbox message. */
export async function dispatchMessage(d: EmailDeps, conn: ConnectionRow, transport: EmailTransport, messageId: string): Promise<SendOutcome | { kind: "skipped"; why: string }> {
  const row = await d.store.getOutbound(messageId);
  if (!row) return { kind: "skipped", why: "not_found" };
  if (row.workspaceId !== conn.workspaceId || row.tenantId !== conn.tenantId) return { kind: "skipped", why: "other_workspace" };   // isolation
  if (row.isInternalNote) return { kind: "skipped", why: "internal_note" };
  if (row.status !== "queued") return { kind: "skipped", why: "not_queued" };
  if (row.channel !== "email") return { kind: "skipped", why: "not_email" };
  const at = () => d.now().toISOString();
  const mark = (s: string, code: string | null) => d.store.patchOutbound(row.id, { status: s, statusAt: at(), errorCode: code, errorDetail: null });
  const { subject, body } = subjectAndBody(row, conn);
  const out = await sendEmail(d, conn, transport, { leadId: row.leadId ?? "", subject, body, merge: false, idempotencyKey: `em:${conn.id}:${row.id}`, messageId: row.id });
  if (out.kind === "sent") {
    await d.store.patchOutbound(row.id, { status: "sent", externalId: out.providerId, statusAt: at(), errorCode: null, errorDetail: null });
    await d.store.emit({ type: "message.sent", workspaceId: conn.workspaceId, objectType: "message", objectId: row.id, data: { channel: "email", conversation_id: row.conversationId } });
  } else if (out.kind === "blocked") await mark("failed", out.reason);
  else if (out.kind === "failed") await mark("failed", out.failure);
  return out;
}

/** The stored subject, else a "Subject: ..." first line, else a generic one built from the tenant's sender name. */
export function subjectAndBody(row: Pick<OutboundRow, "subject" | "body">, conn: Pick<ConnectionRow, "settings">): { subject: string; body: string } {
  const body = row.body ?? "";
  if (row.subject) return { subject: row.subject, body };
  const m = /^subject:[ \t]*([^\r\n]{1,200})\r?\n(?:\r?\n)?([\s\S]*)$/i.exec(body);
  if (m) return { subject: m[1].trim(), body: m[2] };
  const name = senderOf(conn.settings).fromName;
  return { subject: name ? `Message from ${name}` : "Message", body };
}

export interface DispatchSummary { sent: number; blocked: number; failed: number; retry: number; skipped: number }
/** Sends up to DISPATCH_BATCH queued messages of the connection's workspace. A retry outcome stops the batch (the provider is throttling). */
export async function dispatchQueued(d: EmailDeps, conn: ConnectionRow, transport: EmailTransport, onReject: (reason: string) => void = () => undefined): Promise<DispatchSummary> {
  const out: DispatchSummary = { sent: 0, blocked: 0, failed: 0, retry: 0, skipped: 0 };
  for (const id of await d.store.listQueuedOutbound(conn.workspaceId, DISPATCH_BATCH)) {
    const r = await dispatchMessage(d, conn, transport, id);
    if (r.kind === "sent") out.sent++;
    else if (r.kind === "blocked") { out.blocked++; onReject(r.reason); }
    else if (r.kind === "failed") { out.failed++; onReject(r.failure); }
    else if (r.kind === "retry") { out.retry++; break; }
    else out.skipped++;
  }
  return out;
}

export interface TemplateBatchResult { sent: number; blocked: Record<string, number>; failed: number; remaining: string[] }
/** Renders a stored template for each lead and sends. Stops at the first retry outcome and returns the leads not yet handled. */
export async function sendTemplateBatch(d: EmailDeps, conn: ConnectionRow, transport: EmailTransport, a: { templateId: string; leadIds: string[]; campaignKey: string }): Promise<TemplateBatchResult> {
  const res: TemplateBatchResult = { sent: 0, blocked: {}, failed: 0, remaining: [] };
  const tpl = await d.store.getTemplate(conn.tenantId, a.templateId);
  if (!tpl || tpl.channel !== "email" || tpl.status === "rejected") { res.blocked.template_unavailable = a.leadIds.length; return res; }
  const { subject, body } = subjectAndBody({ subject: tpl.subject, body: tpl.body }, conn);
  for (let i = 0; i < a.leadIds.length; i++) {
    const leadId = a.leadIds[i];
    const out = await sendEmail(d, conn, transport, { leadId, subject, body, merge: true, idempotencyKey: `em:${conn.id}:${a.campaignKey}:${leadId}` });
    if (out.kind === "sent") {
      res.sent++;
      const rcpt = await d.store.getRecipient(conn.workspaceId, leadId);
      if (rcpt?.email) await d.store.createOutbound({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, leadId, email: rcpt.email, subject, body, templateId: tpl.id }, { status: "sent", providerId: out.providerId, at: d.now().toISOString() });
    } else if (out.kind === "blocked") res.blocked[out.reason] = (res.blocked[out.reason] ?? 0) + 1;
    else if (out.kind === "failed") res.failed++;
    else { res.remaining = a.leadIds.slice(i); break; }
  }
  return res;
}
