// Server-action targets for the Outlook connector (the integrator wraps them; the browser sends ids and text, never a token).
// Every action: the connection must belong to the caller's tenant and workspace (a foreign one looks missing), audit comes first
// (audit or nothing), and the Showcase gateway never leaves the process.
import type { RuntimeDeps } from "../core/ports";
import { refreshIfNeeded } from "../core/lifecycle";
import { loadSecrets } from "../core/secrets";
import { CredentialError, TransientError, type ConnectionRow, type ConsentPurpose } from "../core/types";
import { cleanEmail } from "./mappers";
import { graphGatewayFor, sameScope } from "./config";
import { MAX_BODY, MAX_RECIPIENTS, MAX_SUBJECT, MS_ID, STREAM_SUBSCRIPTIONS } from "./constants";
import type { MsDeps } from "./store";
import { ensureSubscriptions } from "./subscriptions";

export interface Actor { uid: string; tenantId: string; workspaceId: string }
export interface MsActionRuntime { rd: RuntimeDeps; deps: MsDeps; env: Record<string, string | undefined>; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }
export type ActionFail = "not_found" | "not_connected" | "invalid_input" | "unknown_recipient" | "no_consent" | "token_rejected" | "vendor_unavailable" | "audit_failed";
export type ActionResult<T> = { ok: true; value: T } | { ok: false; code: ActionFail };

const WORKING = new Set(["connected", "sandbox"]);
async function load(rt: MsActionRuntime, actor: Actor, connectionId: string): Promise<ConnectionRow | ActionFail> {
  const conn = await rt.rd.store.getConnection(connectionId);
  if (!sameScope(conn, actor, MS_ID)) return "not_found";
  if (!conn.credentialSecretId || !WORKING.has(conn.status)) return "not_connected";
  return conn;
}
async function auditFirst(rt: MsActionRuntime, e: { action: string; summary: string; connectionId: string; detail?: Record<string, unknown> }): Promise<boolean> {
  if (!rt.rd.audit) return true;
  try { await rt.rd.audit(e); return true; } catch { return false; }
}
const failOf = (e: unknown): ActionFail | null => (e instanceof CredentialError ? "token_rejected" : e instanceof TransientError ? "vendor_unavailable" : null);

export interface SendInput {
  connectionId: string; to: string[]; subject: string; body: string;
  /** Consent purpose checked for every recipient that is a lead. One-to-one correspondence from the user's own mailbox: default `demo_followup`. */
  purpose?: ConsentPurpose;
}

/**
 * Sends one plain-text mail from the connected mailbox to KNOWN contacts only: every recipient must be a lead or contact of this workspace,
 * and a lead that withdrew consent blocks the send. Which recipient failed is not revealed. The sent copy arrives through the Sent Items
 * stream (no second record is written here, so there are no duplicates).
 */
export async function sendOutlookMail(rt: MsActionRuntime, actor: Actor, i: SendInput): Promise<ActionResult<{ recipients: number }>> {
  const conn = await load(rt, actor, i.connectionId);
  if (typeof conn === "string") return { ok: false, code: conn };
  const to = [...new Set((Array.isArray(i.to) ? i.to : []).map(cleanEmail))];
  const subject = typeof i.subject === "string" ? i.subject.trim() : "", body = typeof i.body === "string" ? i.body : "";
  if (!to.length || to.length > MAX_RECIPIENTS || to.some((x) => !x) || !subject || subject.length > MAX_SUBJECT || /[\r\n]/.test(subject) || !body.trim() || body.length > MAX_BODY) return { ok: false, code: "invalid_input" };
  const emails = to as string[];
  const known = await rt.deps.store.matchContacts({ tenantId: conn.tenantId, workspaceId: conn.workspaceId }, emails);
  if (emails.some((e) => !known.has(e))) return { ok: false, code: "unknown_recipient" };
  const purpose = i.purpose ?? "demo_followup";
  for (const k of new Set([...known.values()].map((v) => v.leadId).filter((x): x is string => !!x))) if (!(await rt.rd.store.canContact(k, purpose))) return { ok: false, code: "no_consent" };
  if (!(await auditFirst(rt, { action: "outlook.mail_sent", summary: "Sent mail from the connected Outlook mailbox", connectionId: conn.id, detail: { recipients: emails.length, by: actor.uid } }))) return { ok: false, code: "audit_failed" };
  try {
    const fresh = await refreshIfNeeded(rt.rd, conn);
    if (!fresh.ok) return { ok: false, code: "token_rejected" };
    const current = (await rt.rd.store.getConnection(conn.id)) ?? conn;
    await graphGatewayFor({ connectionId: conn.id, secrets: await loadSecrets(rt.rd.vault, current), env: rt.env, fetchImpl: rt.fetchImpl, sleep: rt.sleep }).sendMail({ to: emails, subject, body });
    return { ok: true, value: { recipients: emails.length } };
  } catch (e) { const f = failOf(e); if (f) return { ok: false, code: f }; throw e; }
}

/** Creates or renews the change-notification subscriptions now (after connecting, or when the owner presses "Repair"). */
export async function subscribeOutlook(rt: MsActionRuntime, actor: Actor, connectionId: string): Promise<ActionResult<{ status: string; created: number; renewed: number }>> {
  const conn = await load(rt, actor, connectionId);
  if (typeof conn === "string") return { ok: false, code: conn };
  if (!(await auditFirst(rt, { action: "outlook.subscriptions_ensured", summary: "Created or renewed Outlook change notifications", connectionId: conn.id, detail: { by: actor.uid } }))) return { ok: false, code: "audit_failed" };
  try {
    const secrets = await loadSecrets(rt.rd.vault, conn);
    const gateway = graphGatewayFor({ connectionId: conn.id, secrets, env: rt.env, fetchImpl: rt.fetchImpl, sleep: rt.sleep });
    const r = await ensureSubscriptions({ rd: rt.rd, deps: rt.deps, gateway, conn, env: rt.env, cursor: await rt.rd.store.getCursor(conn.id, STREAM_SUBSCRIPTIONS) });
    await rt.rd.store.setCursor(conn.id, STREAM_SUBSCRIPTIONS, r.cursor);
    return { ok: true, value: { status: r.cursor.status, created: r.created, renewed: r.renewed } };
  } catch (e) { const f = failOf(e); if (f) return { ok: false, code: f }; throw e; }
}
