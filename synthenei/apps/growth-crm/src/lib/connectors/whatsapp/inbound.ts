// Inbound pipeline: one parsed webhook event -> conversation / message / consent / status updates. Runs from the connector_inbound
// consumer AFTER the edge verified X-Hub-Signature-256 (verify/receive.ts); nothing here re-checks signatures.
// Idempotent end to end: a re-delivered message is found by wamid and skipped, statuses never move backwards, and the consent
// write for a keyword is skipped when the latest consent is already a withdrawal.
import { createHash } from "node:crypto";
import { e164Phone } from "../core/transforms";
import type { ConnectionRow, ConnectionSecrets } from "../core/types";
import { CRED, MAX_MEDIA_BYTES, MEDIA_BUCKET } from "./constants";
import type { WhatsAppGateway } from "./gateway";
import { isOptOut } from "./optout";
import { bodyOf, type WaEvent, type WaInboundMessage } from "./payload";
import { mapStatus } from "./templates";
import type { ConnScope, WaDeps } from "./store";

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
export const scopeOf = (c: ConnectionRow): ConnScope => ({ tenantId: c.tenantId, workspaceId: c.workspaceId, connectionId: c.id });
const plus = (waId: string) => `+${waId}`;

export interface InboundCtx { deps: WaDeps; conn: ConnectionRow; secrets: ConnectionSecrets; gateway: () => WhatsAppGateway; reject: (reason: string) => void }

/** Tenant isolation: an event is processed only when its phone_number_id is the one stored in THIS connection's credentials. */
export const ownsNumber = (secrets: ConnectionSecrets, phoneNumberId: string): boolean => !!secrets[CRED.phoneNumberId] && secrets[CRED.phoneNumberId] === phoneNumberId;

export async function handleEvent(c: InboundCtx, evt: WaEvent): Promise<void> {
  if (evt.kind === "template_status") {
    const st = mapStatus(evt.status);
    const hit = await c.deps.store.setTemplateStatusByProviderId(c.conn.id, evt.providerTemplateId, st.status, evt.reason ?? null);
    if (!hit) c.reject("unknown_template");
    return;
  }
  if (!ownsNumber(c.secrets, evt.phoneNumberId)) { c.reject("phone_number_mismatch"); return; }   // never touch another workspace's number
  if (evt.kind === "status") return handleStatus(c, evt);
  return handleMessage(c, evt);
}

async function handleStatus(c: InboundCtx, evt: Extract<WaEvent, { kind: "status" }>): Promise<void> {
  const err = evt.status === "failed" ? { code: String(evt.errors?.[0]?.code ?? "unknown"), detail: evt.errors?.[0]?.title ?? evt.errors?.[0]?.detail } : undefined;
  const r = await c.deps.store.applyStatus(c.conn.tenantId, evt.wamid, evt.status, evt.at, err);
  if (r.result === "unknown") { c.reject("unknown_message"); return; }
  if (r.result === "updated" && r.messageId) await c.deps.store.emit({ type: "message.status", workspaceId: c.conn.workspaceId, objectType: "message", objectId: r.messageId, data: { status: evt.status, channel: "whatsapp", ...(evt.pricingCategory ? { pricing_category: evt.pricingCategory } : {}) } });
}

async function handleMessage(c: InboundCtx, evt: Extract<WaEvent, { kind: "message" }>): Promise<void> {
  const { deps, conn } = c, m = evt.message, st = deps.store;
  if (m.type === "reaction") return;   // reactions are not conversation messages
  if (await st.findMessageByWamid(conn.tenantId, m.wamid)) return;   // vendor retry: already stored

  const e164 = e164Phone(plus(m.from)) as string | null;
  if (!e164) { c.reject("invalid_phone"); return; }
  const text = m.type === "text" ? m.text ?? "" : "";
  const optOut = isOptOut(text);

  let leadId = await st.findLeadByPhone(conn.workspaceId, e164);
  if (!leadId && !optOut) leadId = await st.createLead(newLeadRow(conn, e164, evt.profileName, m));

  const conv = await st.upsertConversation({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, waId: m.from, leadId });
  const pending = m.media ? [{ kind: m.media.kind, media_id: m.media.mediaId, mime: m.media.mime ?? null, sha256: m.media.sha256 ?? null, filename: m.media.filename ?? null, status: "pending" }] : undefined;
  const ins = await st.insertInbound({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, conversationId: conv.id, wamid: m.wamid, body: bodyOf(m), at: m.at, attachments: pending, replyToWamid: m.replyToWamid });
  if ("duplicate" in ins) return;
  await st.touchInbound(conv.id, m.at, leadId);

  if (m.media) await storeMedia(c, ins.id, m);

  if (optOut) await optOutOf(c, leadId, e164);
  else if (leadId && conn.settings.inbound_implies_optin === true && (await st.latestConsent(leadId)) === null) {
    await st.recordConsent({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, leadId, subjectRef: sha256Hex(e164), purpose: "whatsapp", action: "granted", note: "customer messaged first" });
    await st.emit({ type: "consent.changed", workspaceId: conn.workspaceId, objectType: "lead", objectId: leadId, data: { purpose: "whatsapp", action: "granted", via: "integration" } });
  }
  await st.emit({ type: "message.received", workspaceId: conn.workspaceId, objectType: "message", objectId: ins.id, data: { channel: "whatsapp", conversation_id: conv.id, kind: m.type } });
}

function newLeadRow(conn: ConnectionRow, e164: string, profileName: string | undefined, m: WaInboundMessage): Record<string, unknown> {
  const ref = m.referral;
  return {
    tenant_id: conn.tenantId, workspace_id: conn.workspaceId, full_name: profileName ?? e164, phone: e164, source: "whatsapp",
    utm: { source: "whatsapp", medium: ref ? "click_to_whatsapp" : "inbound", ...(ref?.sourceId ? { campaign: ref.sourceId } : {}) },
    click_ids: ref?.ctwaClid ? { ctwa_clid: ref.ctwaClid } : {},
    ...(ref?.sourceUrl ? { landing_path: ref.sourceUrl.slice(0, 300) } : {}),
  };
}

/** Honours STOP: withdraws WhatsApp consent. can_contact() then blocks every later send, including queued ones. */
async function optOutOf(c: InboundCtx, leadId: string | null, e164: string): Promise<void> {
  const { store } = c.deps;
  if (leadId && (await store.latestConsent(leadId)) === "withdrawn") return;   // already withdrawn: idempotent
  await store.recordConsent({ tenantId: c.conn.tenantId, workspaceId: c.conn.workspaceId, leadId, subjectRef: sha256Hex(e164), purpose: "whatsapp", action: "withdrawn", note: "customer sent an opt-out keyword" });
  await store.emit({ type: "consent.changed", workspaceId: c.conn.workspaceId, objectType: leadId ? "lead" : "integration", objectId: leadId ?? c.conn.id, data: { purpose: "whatsapp", action: "withdrawn", via: "integration" } });
}

/** Media by reference: bytes go to the private bucket, the message keeps only the path. Failure never loses the message. */
async function storeMedia(c: InboundCtx, messageId: string, m: WaInboundMessage): Promise<void> {
  const media = m.media;
  if (!media) return;
  const { store, media: bucket, log } = c.deps;
  const base = { kind: media.kind, media_id: media.mediaId, filename: media.filename ?? null, sha256: media.sha256 ?? null };
  try {
    const gw = c.gateway();
    const info = await gw.getMediaInfo(media.mediaId);
    if (info.size !== undefined && info.size > MAX_MEDIA_BYTES) { await store.setAttachments(messageId, [{ ...base, mime: info.mime ?? media.mime ?? null, status: "failed", reason: "too_large" }]); return; }
    const file = await gw.downloadMedia(info.url, MAX_MEDIA_BYTES);
    const mime = file.mime ?? info.mime ?? media.mime;
    const path = `${c.conn.tenantId}/${c.conn.workspaceId}/${c.conn.id}/${messageId}`;
    await bucket.put(path, file.bytes, mime);
    await store.setAttachments(messageId, [{ ...base, mime: mime ?? null, size: file.bytes.byteLength, bucket: MEDIA_BUCKET, path, status: "stored" }]);
  } catch (e) {
    log.warn("whatsapp media not stored", { message: messageId, reason: e instanceof Error ? e.name : "error" });
    await store.setAttachments(messageId, [{ ...base, mime: media.mime ?? null, status: "failed", reason: "download_failed" }]).catch(() => undefined);
  }
}
