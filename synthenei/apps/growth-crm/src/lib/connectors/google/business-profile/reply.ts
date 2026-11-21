// Review reply workflow: draft (AI, template or human) -> pending_approval -> approved BY A NAMED HUMAN -> posted to Google.
// Rules enforced here AND by the 0019 trigger / constraint (defence in depth):
//   * nothing is posted unless the row is `approved` with a non-empty approver and a non-empty draft, re-read at post time;
//   * the approver is the acting user (a uid), never a drafter, a job or a client-supplied id;
//   * editing a draft sends it back to `draft`, so an approval always covers exactly the text that is posted;
//   * approve and post are audited first: audit or nothing.
// Callers (server actions, not in this task's Owns) check `inbox.reply` and pass the session actor.
import type { RuntimeDeps } from "../../core/ports";
import { loadSecrets } from "../../core/secrets";
import { CredentialError, TransientError } from "../../core/types";
import { connectionOf, isUsable, type Actor } from "../shared/select";
import { gbpGatewayFor } from "./config";
import { GBP_CONNECTOR_ID, GBP_CRED } from "./constants";
import { cleanReplyText, templateDrafter, type ReplyDrafter } from "./drafter";
import type { GbpStore, ReplySource, StoredReview } from "./store";

export type ReplyFail = "not_found" | "invalid_state" | "invalid_input" | "not_connected" | "no_listing" | "token_rejected" | "post_failed" | "audit_failed" | "conflict" | "not_signed_in";
export type ReplyResult<T = true> = { ok: true; value: T } | { ok: false; code: ReplyFail };
export interface ReplyDeps { rt: RuntimeDeps; store: GbpStore; drafter?: ReplyDrafter; fetchImpl?: typeof fetch; /** test seam for backoff */ sleep?: (ms: number) => Promise<void> }

const fail = (code: ReplyFail): { ok: false; code: ReplyFail } => ({ ok: false, code });
const scope = (a: Actor) => ({ tenantId: a.tenantId, workspaceId: a.workspaceId });
const EDITABLE = ["none", "draft", "pending_approval", "failed", "approved"] as const;

async function load(d: ReplyDeps, a: Actor, id: string): Promise<StoredReview | null> {
  const r = await d.store.getReview(scope(a), id);
  return r && r.connectionId && r.externalId ? r : null;
}
async function audit(d: ReplyDeps, r: StoredReview, action: string, summary: string, detail: Record<string, unknown>): Promise<boolean> {
  if (!d.rt.audit) return true;
  try { await d.rt.audit({ action, summary, connectionId: r.connectionId ?? "", detail: { review: r.id, ...detail } }); return true; } catch { return false; }
}

/** Creates or replaces the draft. `text` = a human's words (source human); without it the drafter writes one (AI or template). */
export async function draftReply(d: ReplyDeps, actor: Actor, reviewId: string, input: { text?: string }): Promise<ReplyResult<{ draft: string; source: ReplySource }>> {
  if (!actor.uid) return fail("not_signed_in");
  const r = await load(d, actor, reviewId);
  if (!r) return fail("not_found");
  if (r.replyStatus === "posted") return fail("invalid_state");
  let text: string | null, source: ReplySource;
  if (input.text !== undefined) { text = cleanReplyText(input.text); source = "human"; }
  else {
    if (r.rating === null) return fail("invalid_input");
    const drafter = d.drafter ?? templateDrafter;
    try { text = cleanReplyText(await drafter.draft({ rating: r.rating, text: r.text, author: r.author })); } catch { return fail("invalid_input"); }
    source = drafter.source;
  }
  if (!text) return fail("invalid_input");
  // approved -> draft is a deliberate send-back: the earlier approval no longer covers the new text
  const ok = await d.store.updateReply(scope(actor), r.id, [...EDITABLE], { replyDraft: text, replyStatus: "draft", replySource: source, replyApprovedBy: null, replyError: null });
  return ok ? { ok: true, value: { draft: text, source } } : fail("conflict");
}

export async function submitForApproval(d: ReplyDeps, actor: Actor, reviewId: string): Promise<ReplyResult> {
  if (!actor.uid) return fail("not_signed_in");
  const r = await load(d, actor, reviewId);
  if (!r) return fail("not_found");
  if (r.replyStatus !== "draft" || !r.replyDraft?.trim()) return fail("invalid_state");
  return (await d.store.updateReply(scope(actor), r.id, ["draft"], { replyStatus: "pending_approval" })) ? { ok: true, value: true } : fail("conflict");
}

/** The human decision. Also the way out of `failed` (a retry needs a fresh approval). Sends back to draft on `reject`. */
export async function decideReply(d: ReplyDeps, actor: Actor, reviewId: string, decision: "approve" | "reject"): Promise<ReplyResult> {
  if (!actor.uid) return fail("not_signed_in");
  const r = await load(d, actor, reviewId);
  if (!r) return fail("not_found");
  if (decision === "reject") {
    if (r.replyStatus !== "pending_approval") return fail("invalid_state");
    return (await d.store.updateReply(scope(actor), r.id, ["pending_approval"], { replyStatus: "draft" })) ? { ok: true, value: true } : fail("conflict");
  }
  if ((r.replyStatus !== "pending_approval" && r.replyStatus !== "failed") || !r.replyDraft?.trim()) return fail("invalid_state");
  if (!(await audit(d, r, "google_business.reply_approved", "Approved a review reply", { source: r.replySource }))) return fail("audit_failed");
  return (await d.store.updateReply(scope(actor), r.id, ["pending_approval", "failed"], { replyStatus: "approved", replyApprovedBy: actor.uid, replyError: null })) ? { ok: true, value: true } : fail("conflict");
}

/** Posts an approved reply. Re-reads the row, so a draft edited after approval (back in `draft`) can never be posted. */
export async function postApprovedReply(d: ReplyDeps, actor: Actor, reviewId: string): Promise<ReplyResult> {
  if (!actor.uid) return fail("not_signed_in");
  const r = await load(d, actor, reviewId);
  if (!r) return fail("not_found");
  if (r.replyStatus !== "approved" || !r.replyApprovedBy || !r.replyDraft?.trim()) return fail("invalid_state");
  const conn = await connectionOf(d.rt, actor, r.connectionId as string, GBP_CONNECTOR_ID);
  if (!conn) return fail("not_found");
  if (!isUsable(conn)) return fail("not_connected");
  const secrets = await loadSecrets(d.rt.vault, conn), account = secrets[GBP_CRED.account], location = secrets[GBP_CRED.location];
  if (!account || !location) return fail("no_listing");
  if (!(await audit(d, r, "google_business.reply_posting", "Posting an approved review reply", { approved_by: r.replyApprovedBy }))) return fail("audit_failed");
  try {
    await gbpGatewayFor({ connectionId: conn.id, secrets, env: d.rt.env, fetchImpl: d.fetchImpl, sleep: d.sleep }).replyToReview({ account, location, reviewId: r.externalId as string, comment: r.replyDraft });
  } catch (e) {
    if (e instanceof TransientError) return fail("post_failed");   // stays approved: the human can press post again
    const credential = e instanceof CredentialError;
    await d.store.updateReply(scope(actor), r.id, ["approved"], { replyStatus: "failed", replyError: credential ? "credentials" : "rejected" });
    return fail(credential ? "token_rejected" : "post_failed");
  }
  const moved = await d.store.updateReply(scope(actor), r.id, ["approved"], { replyStatus: "posted" });
  if (!moved) d.rt.log.warn("gbp: reply posted but the row had moved", { review: r.id });
  return { ok: true, value: true };
}
