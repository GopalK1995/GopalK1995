// Instagram DM inbound: one parsed messaging event -> lead / conversation / message. Runs from the connector_inbound consumer AFTER
// the edge verified X-Hub-Signature-256 (verify/receive.ts); nothing here re-checks signatures. Idempotent: a re-delivered message
// is found by its mid and skipped, last_inbound_at only moves forward (it is the 24 h window's clock).
import type { ConnectionRow, ConnectionSecrets } from "../core/types";
import { CRED } from "./constants";
import type { MetaGateway } from "./gateway";
import { bodyOf, type IgMessageEvent } from "./payload";
import type { MetaDeps } from "./store";

/** Tenant isolation: an event is processed only for the Instagram account this connection selected. */
export const ownsIg = (secrets: ConnectionSecrets, igUserId: string): boolean => !!secrets[CRED.igUserId] && secrets[CRED.igUserId] === igUserId;

export interface IgCtx { deps: MetaDeps; conn: ConnectionRow; secrets: ConnectionSecrets; gateway: MetaGateway; reject: (reason: string) => void }
export type IgOutcome = "stored" | "duplicate" | "rejected";

export async function handleIgMessage(c: IgCtx, evt: IgMessageEvent): Promise<IgOutcome> {
  const { deps, conn } = c, st = deps.store;
  if (!ownsIg(c.secrets, evt.igUserId)) { c.reject("ig_account_mismatch"); return "rejected"; }   // never touch another workspace's account
  if (await st.findMessageByExternalId(conn.tenantId, evt.mid)) return "duplicate";   // vendor retry: already stored

  let leadId = await st.findLeadByIgsid(conn.workspaceId, evt.senderId);
  if (!leadId) {
    let profile: { name?: string; username?: string } = {};
    try { profile = await c.gateway.igProfile(evt.senderId); } catch { /* the name is a nicety: a failed lookup never loses the message */ }
    leadId = await st.createLead(newLeadRow(conn, evt, profile));
  }
  const conv = await st.upsertConversation({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, threadId: evt.senderId, leadId });
  const ins = await st.insertInbound({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, conversationId: conv.id, mid: evt.mid, body: bodyOf(evt), at: evt.at, replyToMid: evt.replyToMid });
  if ("duplicate" in ins) return "duplicate";
  await st.touchInbound(conv.id, evt.at, leadId);
  await st.emit({ type: "message.received", workspaceId: conn.workspaceId, objectType: "message", objectId: ins.id, data: { channel: "instagram", conversation_id: conv.id, kind: evt.attachments.length && !evt.text ? "attachment" : "text" } });
  return "stored";
}

function newLeadRow(conn: ConnectionRow, evt: IgMessageEvent, p: { name?: string; username?: string }): Record<string, unknown> {
  return {
    tenant_id: conn.tenantId, workspace_id: conn.workspaceId, full_name: p.name ?? p.username ?? "Instagram user", source: "instagram",
    first_touch_channel: "meta", last_touch_channel: "meta", last_touch_at: evt.at,
    utm: { source: "instagram", medium: "dm" },
    external_ids: { instagram_igsid: evt.senderId, ...(p.username ? { instagram_username: p.username } : {}) },
  };
}
