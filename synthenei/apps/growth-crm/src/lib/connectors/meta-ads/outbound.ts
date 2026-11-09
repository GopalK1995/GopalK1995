// Instagram DM outbound: takes a message the inbox stored as `queued` (T028 send path) and delivers it through the gateway.
// Gate order, each failing CLOSED and recorded on the message (never silently dropped):
//   queued instagram reply, not a note -> thread known -> text present and within 1000 bytes
//   -> inside the 24 h window (Instagram has no templates: outside the window nothing can be sent) -> throttle -> send.
// Replies inside the window answer a person who wrote first, so no marketing consent purpose applies; a closed window is the
// consent boundary. A transient failure leaves the row `queued` for the next run; a permanent one marks it `failed` with the code.
import { CredentialError, TransientError, type ConnectionRow } from "../core/types";
import { serviceWindow } from "../whatsapp/window";
import { DISPATCH_BATCH, MAX_IG_TEXT_BYTES, SEND_PER_MINUTE } from "./constants";
import { MetaApiError, type MetaGateway } from "./gateway";
import type { MetaDeps } from "./store";

export type BlockReason = "no_recipient" | "empty_text" | "text_too_long" | "window_closed";
export type DispatchOutcome =
  | { kind: "skipped"; why: "not_found" | "not_instagram" | "not_queued" | "internal_note" | "other_workspace" }
  | { kind: "sent"; mid: string }
  | { kind: "blocked"; reason: BlockReason }
  | { kind: "failed"; code: number | null; failure: string }
  | { kind: "retry"; why: "throttled" | "transient"; retryAfterMs?: number };

async function block(d: MetaDeps, id: string, reason: BlockReason): Promise<DispatchOutcome> {
  await d.store.patchOutbound(id, { status: "failed", statusAt: d.now().toISOString(), errorCode: reason, errorDetail: null });
  return { kind: "blocked", reason };
}

export async function dispatchMessage(d: MetaDeps, conn: ConnectionRow, gw: MetaGateway, messageId: string): Promise<DispatchOutcome> {
  const row = await d.store.getOutbound(messageId);
  if (!row) return { kind: "skipped", why: "not_found" };
  if (row.workspaceId !== conn.workspaceId || row.tenantId !== conn.tenantId) return { kind: "skipped", why: "other_workspace" };   // isolation
  if (row.isInternalNote) return { kind: "skipped", why: "internal_note" };
  if (row.status !== "queued") return { kind: "skipped", why: "not_queued" };
  if (row.channel !== "instagram") return { kind: "skipped", why: "not_instagram" };
  if (!row.threadId) return block(d, row.id, "no_recipient");
  const body = (row.body ?? "").trim();
  if (!body) return block(d, row.id, "empty_text");
  if (Buffer.byteLength(body, "utf8") > MAX_IG_TEXT_BYTES) return block(d, row.id, "text_too_long");
  if (!serviceWindow(row.lastInboundAt, d.now()).open) return block(d, row.id, "window_closed");
  if (!(await d.rate(`ig-send:${conn.id}`, SEND_PER_MINUTE, 60_000))) return { kind: "retry", why: "throttled", retryAfterMs: 5_000 };

  try {
    const r = await gw.sendIgMessage({ recipientId: row.threadId, text: body });
    await d.store.patchOutbound(row.id, { status: "sent", externalId: r.mid, statusAt: d.now().toISOString(), errorCode: null, errorDetail: null });
    await d.store.emit({ type: "message.sent", workspaceId: conn.workspaceId, objectType: "message", objectId: row.id, data: { channel: "instagram", conversation_id: row.conversationId, kind: "text" } });
    return { kind: "sent", mid: r.mid };
  } catch (e) {
    if (e instanceof CredentialError) throw e;   // the whole connection needs attention; the row stays queued
    if (e instanceof TransientError) return { kind: "retry", why: "transient", retryAfterMs: e.retryAfterMs };
    if (e instanceof MetaApiError) {
      if (e.transient) return { kind: "retry", why: "transient" };
      await d.store.patchOutbound(row.id, { status: "failed", statusAt: d.now().toISOString(), errorCode: e.failure === "window_closed" ? "window_closed" : String(e.code), errorDetail: e.failure });
      return { kind: "failed", code: e.code, failure: e.failure };
    }
    throw e;
  }
}

export interface DispatchSummary { sent: number; blocked: number; failed: number; retry: number; skipped: number }
/** Sends up to DISPATCH_BATCH queued Instagram messages of the connection's workspace. A retry outcome stops the batch (Meta is throttling). */
export async function dispatchQueued(d: MetaDeps, conn: ConnectionRow, gw: MetaGateway, onReject: (reason: string) => void = () => undefined): Promise<DispatchSummary> {
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
