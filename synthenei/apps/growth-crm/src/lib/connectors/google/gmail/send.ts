// Server-action target: reply in a Gmail thread that the CRM already holds with a known contact. The reply goes out from the ACTING
// user's own connected mailbox (their grant), only into a thread of this workspace whose contact is a participant, and only when the
// gate is open and the tenant opted in. Audited (ids only, never the body). The caller enforces `inbox.reply` and consent.
import type { RuntimeDeps } from "../../core/ports";
import { loadSecrets } from "../../core/secrets";
import { CredentialError } from "../../core/types";
import { grantFor } from "../calendar/grants";
import { scopeOf } from "../shared/mode";
import { connectionOf, isUsable, type Actor, type SelectResult } from "../shared/select";
import { gmailGatewayFor } from "./config";
import { GMAIL_CONNECTOR_ID } from "./constants";
import { gmailGate } from "./gate";
import { addressesIn, buildReply, parseMessage, type ParsedMessage } from "./matcher";
import { gmailOptedIn } from "./sync";
import type { GmailDeps } from "./store";

export type SendFail = "gate_closed" | "thread_not_found" | "not_known_contact" | "empty_body";
export const MAX_REPLY = 20_000;

export async function sendGmailReply(d: RuntimeDeps, deps: GmailDeps, actor: Actor, connectionId: string, input: { threadId: string; body: string }, fetchImpl?: typeof fetch): Promise<SelectResult<{ messageId: string }> | { ok: false; code: SendFail }> {
  const conn = await connectionOf(d, actor, connectionId, GMAIL_CONNECTOR_ID);
  if (!conn) return { ok: false, code: "not_found" };
  if (!isUsable(conn)) return { ok: false, code: "not_connected" };
  const body = input.body.trim();
  if (!body || body.length > MAX_REPLY || !/^[0-9a-zA-Z_-]{1,64}$/.test(input.threadId)) return { ok: false, code: body ? "invalid_input" : "empty_body" };
  const secrets = await loadSecrets(d.vault, conn);
  if (!gmailGate(d.env, gmailOptedIn(secrets)).open) return { ok: false, code: "gate_closed" };
  const grant = grantFor(secrets, actor.uid);
  if (!grant) return { ok: false, code: "not_connected" };
  const scope = scopeOf(conn);
  const stored = await deps.store.findThread(scope, input.threadId);
  if (!stored) return { ok: false, code: "thread_not_found" };   // another workspace's thread, or one the matcher never kept
  const gateway = gmailGatewayFor({ secrets, env: d.env, fetchImpl });
  try {
    const self = (grant.email || (await gateway.profile(grant.access)).email).toLowerCase();
    const thread = await gateway.getThread(grant.access, input.threadId);
    const msgs = (thread?.messages ?? []).map((m) => parseMessage(m, self)).filter((m): m is ParsedMessage => !!m);
    if (!msgs.length) return { ok: false, code: "thread_not_found" };
    const people = [...new Set(msgs.flatMap((m) => [m.from, ...m.to]).filter((a): a is string => !!a && a !== self))];
    const known = await deps.store.contactsByEmail(scope, people);
    const to = people.find((a) => { const c = known.get(a); return !!c && c.id === stored.contact.id; });
    if (!to) return { ok: false, code: "not_known_contact" };
    const last = [...msgs].reverse().find((m) => m.messageIdHeader);
    const raw = buildReply({ from: self, to: addressesIn(to)[0], subject: msgs[0].subject, body, inReplyTo: last?.messageIdHeader ?? null, references: last?.references ?? null });
    // audit or nothing: the intent is recorded before anything leaves
    if (d.audit) { try { await d.audit({ action: "gmail.reply_sent", summary: "Sent an email reply", connectionId: conn.id, detail: { thread: input.threadId, conversation: stored.conversationId } }); } catch { return { ok: false, code: "audit_failed" }; } }
    const sent = await gateway.send(grant.access, raw, input.threadId);
    await deps.store.saveSent(scope, stored.conversationId, { externalId: sent.id, body, sentBy: actor.uid, sentAt: (d.now ? d.now() : new Date()).toISOString() });
    return { ok: true, value: { messageId: sent.id } };
  } catch (e) {
    if (e instanceof CredentialError) return { ok: false, code: "token_rejected" };
    throw e;
  }
}
