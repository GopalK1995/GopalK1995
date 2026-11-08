// Outbound dispatch: takes a message the inbox stored as `queued` (T028 send path) and delivers it through the gateway.
// Gate order, each failing CLOSED and recorded on the message (never silently dropped):
//   not a note / still queued -> lead linked -> can_contact(whatsapp) (covers STOP) -> recipient -> throttle
//   -> template (approved, parameters recoverable) OR free text inside the 24 h window -> send.
// A transient vendor failure leaves the row `queued` for the next run; a permanent one marks it `failed` with the vendor code.
import { CredentialError, TransientError, type ConnectionRow } from "../core/types";
import { DISPATCH_BATCH, MAX_TEXT_LENGTH, SEND_PER_MINUTE } from "./constants";
import { WhatsAppApiError, type WhatsAppGateway } from "./gateway";
import { extractTemplateParams, vendorLanguage } from "./templates";
import type { OutboundRow, WaDeps } from "./store";
import { serviceWindow } from "./window";

export type BlockReason = "no_lead" | "no_consent" | "no_recipient" | "template_not_approved" | "template_params" | "text_too_long" | "window_closed";
export type DispatchOutcome =
  | { kind: "skipped"; why: "not_found" | "not_whatsapp" | "not_queued" | "internal_note" | "other_workspace" }
  | { kind: "sent"; wamid: string }
  | { kind: "blocked"; reason: BlockReason }
  | { kind: "failed"; code: number | null; failure: string }
  | { kind: "retry"; why: "throttled" | "transient"; retryAfterMs?: number };

const digitsOnly = (s: string) => s.replace(/\D/g, "");

/** Marks the row with the reason; a closed window uses pending_template so the inbox can prompt for a template. */
async function block(d: WaDeps, id: string, reason: BlockReason): Promise<DispatchOutcome> {
  await d.store.patchOutbound(id, { status: reason === "window_closed" ? "pending_template" : "failed", statusAt: d.now().toISOString(), errorCode: reason, errorDetail: null });
  return { kind: "blocked", reason };
}

export async function dispatchMessage(d: WaDeps, conn: ConnectionRow, gw: WhatsAppGateway, messageId: string): Promise<DispatchOutcome> {
  const row = await d.store.getOutbound(messageId);
  if (!row) return { kind: "skipped", why: "not_found" };
  if (row.workspaceId !== conn.workspaceId || row.tenantId !== conn.tenantId) return { kind: "skipped", why: "other_workspace" };   // isolation
  if (row.isInternalNote) return { kind: "skipped", why: "internal_note" };
  if (row.status !== "queued") return { kind: "skipped", why: "not_queued" };
  if (row.channel !== "whatsapp") return { kind: "skipped", why: "not_whatsapp" };
  if (!row.leadId) return block(d, row.id, "no_lead");
  // Consent is re-checked at send time: a STOP that arrived after the message was queued must still win. A throw propagates (fail closed, job retries).
  if (!(await d.store.canContact(row.leadId, "whatsapp"))) return block(d, row.id, "no_consent");

  const phone = row.waId ?? (await d.store.leadPhone(row.leadId));
  const to = phone ? digitsOnly(phone) : "";
  if (to.length < 6) return block(d, row.id, "no_recipient");

  const now = d.now();
  let tpl: { name: string; language: string; params: string[] } | null = null;
  if (row.templateId) {
    const t = await d.store.getTemplate(row.tenantId, row.templateId);
    if (!t || t.status !== "approved") return block(d, row.id, "template_not_approved");
    const params = extractTemplateParams(t.body, row.body ?? "");
    if (!params) return block(d, row.id, "template_params");
    tpl = { name: t.name, language: vendorLanguage(t.components, t.language), params };
  } else {
    if (!(row.body ?? "").trim()) return block(d, row.id, "template_params");
    if ((row.body ?? "").length > MAX_TEXT_LENGTH) return block(d, row.id, "text_too_long");
    if (!serviceWindow(row.lastInboundAt, now).open) return block(d, row.id, "window_closed");
  }

  if (!(await d.rate(`wa-send:${conn.id}`, SEND_PER_MINUTE, 60_000))) return { kind: "retry", why: "throttled", retryAfterMs: 5_000 };

  try {
    const r = tpl ? await gw.sendTemplate({ to, name: tpl.name, language: tpl.language, bodyParams: tpl.params }) : await gw.sendText({ to, body: row.body ?? "" });
    await d.store.patchOutbound(row.id, { status: "sent", externalId: r.wamid, statusAt: d.now().toISOString(), errorCode: null, errorDetail: null });
    await d.store.emit({ type: "message.sent", workspaceId: conn.workspaceId, objectType: "message", objectId: row.id, data: { channel: "whatsapp", conversation_id: row.conversationId, kind: tpl ? "template" : "text" } });
    return { kind: "sent", wamid: r.wamid };
  } catch (e) {
    if (e instanceof CredentialError) throw e;   // the whole connection needs attention; the row stays queued
    if (e instanceof TransientError) return { kind: "retry", why: "transient", retryAfterMs: e.retryAfterMs };
    if (e instanceof WhatsAppApiError) {
      if (e.transient) return { kind: "retry", why: "transient" };
      await d.store.patchOutbound(row.id, { status: e.failure === "window_closed" ? "pending_template" : "failed", statusAt: d.now().toISOString(), errorCode: String(e.code), errorDetail: e.failure });
      return { kind: "failed", code: e.code, failure: e.failure };
    }
    throw e;
  }
}

export interface DispatchSummary { sent: number; blocked: number; failed: number; retry: number; skipped: number }
/** Sends up to DISPATCH_BATCH queued messages of the connection's workspace. A retry outcome stops the batch (the vendor is throttling). */
export async function dispatchQueued(d: WaDeps, conn: ConnectionRow, gw: WhatsAppGateway, onReject: (reason: string) => void = () => undefined): Promise<DispatchSummary> {
  const out: DispatchSummary = { sent: 0, blocked: 0, failed: 0, retry: 0, skipped: 0 };
  for (const id of await d.store.listQueuedOutbound(conn.workspaceId, DISPATCH_BATCH)) {
    const r = await dispatchMessage(d, conn, gw, id);
    if (r.kind === "sent") out.sent++;
    else if (r.kind === "blocked") { out.blocked++; onReject(r.reason); }
    else if (r.kind === "failed") { out.failed++; onReject(r.failure); }
    else if (r.kind === "retry") { out.retry++; break; }
    else out.skipped++;
  }
  return out;
}

export type { OutboundRow };
