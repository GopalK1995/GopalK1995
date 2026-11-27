// Public request intake (DPDP). Two steps, so nobody can file a request in someone else's name:
//   1. requestVerification: validate, rate limit, mail a sealed link to the address given. Nothing is stored. The answer is the same
//      whether or not the address belongs to anyone (no way to probe who is in the CRM).
//   2. confirmRequest: the person opens the link and presses the button (GET never writes: mail scanners prefetch links). Only now is a
//      privacy_requests row written, one per matching lead (or one with no lead), carrying only the hash of the address.
// Withdrawal is applied on confirmation: consent_log rows, lead consent flags and the email suppression list. Pure over ports.
import { openIntake, sealIntake } from "./token";
import { tokenHash, type TokenPort } from "./tokens";
import { issueStatusToken, type AuditEntry } from "./dsr";
import { ipHash, uaClass, type NoticeSnapshot, type UaClass } from "./evidence";
import type { OpenRequest } from "./alerts";
import { isEmail, normaliseEmail, subjectRefOf } from "./subject";
import { isPurpose, isRequestKind, type ConsentPurpose, type PublicWorkspace, type RequestKind } from "./types";

export const VERIFY_TTL_MS = 24 * 3_600_000;
export const DETAILS_MAX = 1000;
/** Per-window limits. IP stops floods, address stops mail-bombing one inbox, workspace stops a distributed run. */
export const INTAKE_LIMITS = {
  ip: { limit: 5, windowMs: 3_600_000 }, address: { limit: 3, windowMs: 3_600_000 }, workspace: { limit: 200, windowMs: 3_600_000 },
  confirmIp: { limit: 20, windowMs: 3_600_000 },
} as const;

export interface IntakeStore {
  workspaceBySlug(slug: string): Promise<PublicWorkspace | null>;
  workspaceById(id: string): Promise<PublicWorkspace | null>;
  leadsByEmail(wsUuid: string, email: string): Promise<string[]>;
  findOpen(wsUuid: string, subjectRef: string, kind: RequestKind, leadId: string | null): Promise<{ id: string; dueAt: string } | null>;
  insertRequest(r: { wsUuid: string; subjectRef: string; leadId: string | null; kind: RequestKind; notes: string | null; status: "received" | "completed"; autoNote?: string }): Promise<{ id: string; dueAt: string }>;
  /** Consent rows (append-only), lead flags and the suppression entry for a withdrawal. Idempotent. */
  withdraw(i: {
    wsUuid: string; tenantUuid: string; email: string; subjectRef: string; leadIds: string[]; purposes: ConsentPurpose[]; noticeVersion: string;
    /** What the row can prove later (AUD-063): the notice text, the form, an HMAC of the address, a coarse user-agent class. All optional. */
    evidence?: { notice: NoticeSnapshot | null; formId: string; ipHash: string | null; uaClass: UaClass | null };
  }): Promise<{ consentRows: number }>;
}
export interface Mail { to: string; subject: string; text: string; dedupe: string }
export interface IntakeDeps {
  store: IntakeStore; secret: string; baseUrl: string; now: () => number;
  /** true = allowed. */
  rate: (key: string, limit: number, windowMs: number) => Promise<boolean>;
  send: (m: Mail) => Promise<"sent" | "queued" | "failed">;
  /** Wording for the mail, supplied by the caller (i18n lives in the page layer). */
  mailText: (ctx: { org: string; kind: RequestKind; link: string; hours: number }) => { subject: string; text: string };
  /** Single-use ledger (AUD-064). Absent, or answering "unsupported" before migration 0032, the link keeps its old behaviour (replayable for 24 h). */
  tokens?: TokenPort;
  /** Best-effort alert to the privacy owner for a new request. A failure never reaches the requester. */
  alert?: (r: OpenRequest) => Promise<void>;
  /** Best-effort audit row (ids, kinds, counts: never a personal value). */
  audit?: (e: AuditEntry) => Promise<boolean>;
  /** Canonical text and hash of the workspace's notice, cited by the consent rows a withdrawal writes. */
  noticeSnapshot?: (ws: PublicWorkspace) => NoticeSnapshot;
}

export type RequestResult =
  | { status: "sent" } | { status: "invalid"; field: "email" | "kind" | "details" | "purposes" } | { status: "rate_limited"; retryAfterSec: number }
  | { status: "unknown_workspace" } | { status: "unavailable" };

export interface RequestInput { workspace: string; kind: string; email: string; details?: string; purposes?: string[]; ip: string }

export const verifyPath = (slug: string, token: string): string => `/privacy/${encodeURIComponent(slug)}/verify/${token}`;

export async function requestVerification(d: IntakeDeps, i: RequestInput): Promise<RequestResult> {
  if (!d.secret || !d.baseUrl) return { status: "unavailable" };
  if (!isRequestKind(i.kind)) return { status: "invalid", field: "kind" };
  const email = normaliseEmail(i.email ?? "");
  if (!isEmail(email)) return { status: "invalid", field: "email" };
  const details = (i.details ?? "").trim();
  if (details.length > DETAILS_MAX) return { status: "invalid", field: "details" };
  const purposes = (i.purposes ?? []).filter(isPurpose);
  if (i.kind === "withdrawal" && purposes.length === 0) return { status: "invalid", field: "purposes" };
  if ((i.kind === "correction" || i.kind === "grievance") && details.length < 5) return { status: "invalid", field: "details" };
  const ws = await d.store.workspaceBySlug(i.workspace);
  if (!ws) return { status: "unknown_workspace" };

  for (const [key, cfg] of [[`ip:${i.ip}`, INTAKE_LIMITS.ip], [`addr:${ws.wsUuid}:${subjectRefOf(email)}`, INTAKE_LIMITS.address], [`ws:${ws.wsUuid}`, INTAKE_LIMITS.workspace]] as const) {
    if (!(await d.rate(`privacy-req:${key}`, cfg.limit, cfg.windowMs))) return { status: "rate_limited", retryAfterSec: Math.ceil(cfg.windowMs / 1000) };
  }
  const token = sealIntake({ w: ws.wsUuid, k: i.kind, e: email, d: details, p: purposes }, d.secret, d.now(), VERIFY_TTL_MS);
  const link = `${d.baseUrl.replace(/\/+$/, "")}${verifyPath(ws.wsSlug, token)}`;
  const text = d.mailText({ org: ws.orgName, kind: i.kind, link, hours: VERIFY_TTL_MS / 3_600_000 });
  const out = await d.send({ to: email, subject: text.subject, text: text.text, dedupe: `privacy:${ws.wsUuid}:${subjectRefOf(email)}:${i.kind}:${Math.floor(d.now() / 600_000)}` });
  return out === "failed" ? { status: "unavailable" } : { status: "sent" };
}

export type ConfirmPreview = { status: "ready" | "used"; kind: RequestKind; orgName: string; slug: string } | { status: "invalid" | "expired" | "unavailable" };
/** Read-only look at a token (what the confirmation page shows). Never writes. */
export async function previewConfirm(d: Pick<IntakeDeps, "store" | "secret" | "now" | "tokens">, token: string): Promise<ConfirmPreview> {
  if (!d.secret) return { status: "unavailable" };
  const o = openIntake(token, d.secret, d.now());
  if (!o.ok) return { status: o.reason === "expired" ? "expired" : "invalid" };
  const ws = await d.store.workspaceById(o.value.w);
  if (!ws || !isRequestKind(o.value.k)) return { status: "invalid" };
  let spent = false;
  if (d.tokens) {
    try { spent = (await d.tokens.peek({ hash: tokenHash(token), purpose: "verify", wsUuid: ws.wsUuid })).state === "used"; } catch { /* no ledger: the page still opens */ }
  }
  return { status: spent ? "used" : "ready", kind: o.value.k, orgName: ws.orgName, slug: ws.wsSlug };
}

export type ConfirmResult =
  | { status: "created"; kind: RequestKind; dueAt: string; refs: string[]; withdrawn?: number; statusToken?: string }
  | { status: "duplicate"; kind: RequestKind; dueAt: string; refs: string[]; statusToken?: string }
  | { status: "invalid" | "expired" | "unavailable" | "rate_limited" | "used" };

const quietly = async (f: () => Promise<unknown> | undefined): Promise<void> => { try { await f(); } catch { /* best effort */ } };

export async function confirmRequest(d: IntakeDeps, token: string, ip: string, userAgent?: string | null): Promise<ConfirmResult> {
  if (!d.secret) return { status: "unavailable" };
  if (!(await d.rate(`privacy-confirm:ip:${ip}`, INTAKE_LIMITS.confirmIp.limit, INTAKE_LIMITS.confirmIp.windowMs))) return { status: "rate_limited" };
  const o = openIntake(token, d.secret, d.now());
  if (!o.ok) return { status: o.reason === "expired" ? "expired" : "invalid" };
  const { w, e: email, d: details, p } = o.value;
  if (!isRequestKind(o.value.k) || !isEmail(email)) return { status: "invalid" };
  const kind = o.value.k;
  const ws = await d.store.workspaceById(w);
  if (!ws) return { status: "invalid" };
  // Single use (PRIV-054): the first confirmation spends the link, a replay is refused. Before migration 0032 the ledger answers
  // "unsupported" and the old behaviour (open requests are de-duplicated, withdrawals are idempotent) is all there is.
  if (d.tokens) {
    let u: Awaited<ReturnType<TokenPort["use"]>>;
    try { u = await d.tokens.use({ hash: tokenHash(token), purpose: "verify", wsUuid: ws.wsUuid, expiresAt: new Date(o.value.exp).toISOString(), register: true }); } catch { return { status: "unavailable" }; }
    if (!u.ok && u.reason !== "unsupported") {
      const reason = u.reason;
      await quietly(() => d.audit?.({ action: "privacy.token_replayed", wsUuid: ws.wsUuid, requestId: null, summary: "A spent verification link was opened again", detail: { purpose: "verify", reason } }));
      return { status: reason === "expired" ? "expired" : reason === "used" ? "used" : "invalid" };
    }
  }
  const subjectRef = subjectRefOf(email);
  const leadIds = await d.store.leadsByEmail(ws.wsUuid, email);
  const targets: (string | null)[] = leadIds.length ? leadIds : [null];
  const notes = details ? `Requester note: ${details}`.slice(0, 4000) : null;

  const refs: string[] = []; let dueAt = ""; let fresh = 0; const created: OpenRequest[] = [];
  for (const leadId of targets) {
    const open = await d.store.findOpen(ws.wsUuid, subjectRef, kind, leadId);
    if (open) { refs.push(open.id); dueAt = dueAt || open.dueAt; continue; }
    const row = await d.store.insertRequest({
      wsUuid: ws.wsUuid, subjectRef, leadId, kind, notes, status: kind === "withdrawal" ? "completed" : "received",
      autoNote: kind === "withdrawal" ? "Withdrawal applied automatically when the requester verified their address." : undefined,
    });
    refs.push(row.id); dueAt = dueAt || row.dueAt; fresh++;
    created.push({ id: row.id, wsUuid: ws.wsUuid, tenantUuid: ws.tenantUuid, kind, status: kind === "withdrawal" ? "completed" : "received", dueAt: row.dueAt });
  }
  let withdrawn: number | undefined;
  if (kind === "withdrawal") {
    const purposes = p.filter(isPurpose);
    const notice = d.noticeSnapshot ? d.noticeSnapshot(ws) : null;
    withdrawn = (await d.store.withdraw({
      wsUuid: ws.wsUuid, tenantUuid: ws.tenantUuid, email, subjectRef, leadIds, purposes, noticeVersion: notice?.version ?? ws.notice.noticeVersion ?? "v1",
      evidence: { notice, formId: "privacy-request-form", ipHash: ipHash(ip, d.secret), uaClass: uaClass(userAgent) },
    })).consentRows;
    await quietly(() => d.audit?.({ action: "privacy.withdrawal_applied", wsUuid: ws.wsUuid, requestId: refs[0] ?? null, summary: "Consent withdrawn by the data principal", detail: { purposes, consentRows: withdrawn } }));
  }
  // The owner hears about every NEW request (not a duplicate). Withdrawals are already complete, so they are logged but not alerted.
  for (const r of created) {
    await quietly(() => d.audit?.({ action: "privacy.request_received", wsUuid: ws.wsUuid, requestId: r.id, summary: "Privacy request confirmed by the requester", detail: { kind, status: r.status, dueAt: r.dueAt } }));
    if (kind !== "withdrawal") await quietly(() => d.alert?.(r));
  }
  let statusToken: string | undefined;
  if (d.tokens && refs[0]) statusToken = (await issueStatusToken({ tokens: d.tokens, secret: d.secret, now: d.now, audit: d.audit ?? (async () => false) }, { wsUuid: ws.wsUuid, tenantUuid: ws.tenantUuid, requestId: refs[0] })) ?? undefined;
  return fresh > 0 ? { status: "created", kind, dueAt, refs, withdrawn, statusToken } : { status: "duplicate", kind, dueAt, refs, statusToken };
}
