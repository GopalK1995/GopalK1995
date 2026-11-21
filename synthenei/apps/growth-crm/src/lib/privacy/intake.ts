// Public request intake (DPDP). Two steps, so nobody can file a request in someone else's name:
//   1. requestVerification: validate, rate limit, mail a sealed link to the address given. Nothing is stored. The answer is the same
//      whether or not the address belongs to anyone (no way to probe who is in the CRM).
//   2. confirmRequest: the person opens the link and presses the button (GET never writes: mail scanners prefetch links). Only now is a
//      privacy_requests row written, one per matching lead (or one with no lead), carrying only the hash of the address.
// Withdrawal is applied on confirmation: consent_log rows, lead consent flags and the email suppression list. Pure over ports.
import { openIntake, sealIntake } from "./token";
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
  withdraw(i: { wsUuid: string; tenantUuid: string; email: string; subjectRef: string; leadIds: string[]; purposes: ConsentPurpose[]; noticeVersion: string }): Promise<{ consentRows: number }>;
}
export interface Mail { to: string; subject: string; text: string; dedupe: string }
export interface IntakeDeps {
  store: IntakeStore; secret: string; baseUrl: string; now: () => number;
  /** true = allowed. */
  rate: (key: string, limit: number, windowMs: number) => Promise<boolean>;
  send: (m: Mail) => Promise<"sent" | "queued" | "failed">;
  /** Wording for the mail, supplied by the caller (i18n lives in the page layer). */
  mailText: (ctx: { org: string; kind: RequestKind; link: string; hours: number }) => { subject: string; text: string };
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

export type ConfirmPreview = { status: "ready"; kind: RequestKind; orgName: string; slug: string } | { status: "invalid" | "expired" | "unavailable" };
/** Read-only look at a token (what the confirmation page shows). Never writes. */
export async function previewConfirm(d: Pick<IntakeDeps, "store" | "secret" | "now">, token: string): Promise<ConfirmPreview> {
  if (!d.secret) return { status: "unavailable" };
  const o = openIntake(token, d.secret, d.now());
  if (!o.ok) return { status: o.reason === "expired" ? "expired" : "invalid" };
  const ws = await d.store.workspaceById(o.value.w);
  return ws && isRequestKind(o.value.k) ? { status: "ready", kind: o.value.k, orgName: ws.orgName, slug: ws.wsSlug } : { status: "invalid" };
}

export type ConfirmResult =
  | { status: "created"; kind: RequestKind; dueAt: string; refs: string[]; withdrawn?: number }
  | { status: "duplicate"; kind: RequestKind; dueAt: string; refs: string[] }
  | { status: "invalid" | "expired" | "unavailable" | "rate_limited" };

export async function confirmRequest(d: IntakeDeps, token: string, ip: string): Promise<ConfirmResult> {
  if (!d.secret) return { status: "unavailable" };
  if (!(await d.rate(`privacy-confirm:ip:${ip}`, INTAKE_LIMITS.confirmIp.limit, INTAKE_LIMITS.confirmIp.windowMs))) return { status: "rate_limited" };
  const o = openIntake(token, d.secret, d.now());
  if (!o.ok) return { status: o.reason === "expired" ? "expired" : "invalid" };
  const { w, e: email, d: details, p } = o.value;
  if (!isRequestKind(o.value.k) || !isEmail(email)) return { status: "invalid" };
  const kind = o.value.k;
  const ws = await d.store.workspaceById(w);
  if (!ws) return { status: "invalid" };
  const subjectRef = subjectRefOf(email);
  const leadIds = await d.store.leadsByEmail(ws.wsUuid, email);
  const targets: (string | null)[] = leadIds.length ? leadIds : [null];
  const notes = details ? `Requester note: ${details}`.slice(0, 4000) : null;

  const refs: string[] = []; let dueAt = ""; let fresh = 0;
  for (const leadId of targets) {
    const open = await d.store.findOpen(ws.wsUuid, subjectRef, kind, leadId);
    if (open) { refs.push(open.id); dueAt = dueAt || open.dueAt; continue; }
    const row = await d.store.insertRequest({
      wsUuid: ws.wsUuid, subjectRef, leadId, kind, notes, status: kind === "withdrawal" ? "completed" : "received",
      autoNote: kind === "withdrawal" ? "Withdrawal applied automatically when the requester verified their address." : undefined,
    });
    refs.push(row.id); dueAt = dueAt || row.dueAt; fresh++;
  }
  let withdrawn: number | undefined;
  if (kind === "withdrawal") {
    const purposes = p.filter(isPurpose);
    withdrawn = (await d.store.withdraw({ wsUuid: ws.wsUuid, tenantUuid: ws.tenantUuid, email, subjectRef, leadIds, purposes, noticeVersion: ws.notice.noticeVersion ?? "v1" })).consentRows;
  }
  return fresh > 0 ? { status: "created", kind, dueAt, refs, withdrawn } : { status: "duplicate", kind, dueAt, refs };
}
