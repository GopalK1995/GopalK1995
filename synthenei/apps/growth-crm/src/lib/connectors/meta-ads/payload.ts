// Webhook payload mappers: Meta leadgen (object "page") and Instagram messaging (object "instagram") JSON -> typed events.
// Pure, defensive, never throws: anything that does not match the documented shape is dropped, never half-parsed.
export interface LeadgenEvent { kind: "leadgen"; pageId: string; leadgenId: string; formId?: string; adId?: string; adgroupId?: string; at: string }
export interface IgAttachment { type: string }
export interface IgMessageEvent {
  kind: "ig_message"; igUserId: string; senderId: string; mid: string; at: string; text?: string; attachments: IgAttachment[]; replyToMid?: string;
}
export type MetaEvent = LeadgenEvent | IgMessageEvent;

type R = Record<string, unknown>;
const isObj = (v: unknown): v is R => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Ids arrive as strings; some payloads send numbers. Digits only, bounded. */
const id = (v: unknown): string | undefined => {
  const x = typeof v === "number" && Number.isFinite(v) ? String(Math.trunc(v)) : typeof v === "string" ? v.trim() : "";
  return /^\d{1,32}$/.test(x) ? x : undefined;
};
const text = (v: unknown, max = 4096): string | undefined => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined);

/** leadgen created_time is unix seconds; messaging timestamps are unix milliseconds. Unparseable -> fallback. */
export function isoFromUnix(v: unknown, unit: "s" | "ms", fallback: string): string {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  const d = new Date(unit === "s" ? n * 1000 : n);
  return Number.isNaN(d.getTime()) ? fallback : d.toISOString();
}

function leadgenOf(change: unknown, fallback: string): LeadgenEvent | null {
  if (!isObj(change) || change.field !== "leadgen" || !isObj(change.value)) return null;
  const v = change.value, leadgenId = id(v.leadgen_id), pageId = id(v.page_id);
  if (!leadgenId || !pageId) return null;
  return { kind: "leadgen", pageId, leadgenId, formId: id(v.form_id), adId: id(v.ad_id), adgroupId: id(v.adgroup_id), at: isoFromUnix(v.created_time, "s", fallback) };
}

function messageOf(entryId: string | undefined, m: unknown, fallback: string): IgMessageEvent | null {
  if (!isObj(m) || !isObj(m.sender) || !isObj(m.recipient) || !isObj(m.message)) return null;
  const msg = m.message;
  if (msg.is_echo === true) return null;                       // our own outgoing message coming back: not an inbound
  if (msg.is_deleted === true) return null;
  const mid = text(msg.mid, 300), senderId = id(m.sender.id), recipientId = id(m.recipient.id);
  const igUserId = recipientId ?? entryId;                     // the business account that received it
  if (!mid || !senderId || !igUserId || senderId === igUserId) return null;
  const attachments = arr(msg.attachments).filter(isObj).map((a) => ({ type: text(a.type, 30) ?? "file" }));
  const body = text(msg.text);
  if (!body && !attachments.length) return null;
  return { kind: "ig_message", igUserId, senderId, mid, at: isoFromUnix(m.timestamp, "ms", fallback), text: body, attachments, replyToMid: isObj(msg.reply_to) ? text(msg.reply_to.mid, 300) : undefined };
}

/** Parses a raw delivery body. Other objects, other fields (read receipts, reactions, postbacks) and garbage produce no events. */
export function parseWebhook(rawBody: string, now: Date = new Date()): MetaEvent[] {
  let j: unknown;
  try { j = JSON.parse(rawBody); } catch { return []; }
  if (!isObj(j)) return [];
  const fallback = now.toISOString(), out: MetaEvent[] = [];
  for (const entry of arr(j.entry)) {
    if (!isObj(entry)) continue;
    if (j.object === "page") {
      for (const c of arr(entry.changes)) { const e = leadgenOf(c, fallback); if (e) out.push(e); }
    } else if (j.object === "instagram") {
      const entryId = id(entry.id);
      for (const m of arr(entry.messaging)) { const e = messageOf(entryId, m, fallback); if (e) out.push(e); }
      for (const c of arr(entry.changes)) if (isObj(c) && c.field === "messages") { const e = messageOf(entryId, c.value, fallback); if (e) out.push(e); }
    }
  }
  return out;
}

/** What the inbox stores as the message body: the text, or a bracket token per attachment kind. */
export function bodyOf(e: IgMessageEvent): string {
  const tokens = e.attachments.map((a) => `[${a.type}]`).join(" ");
  return [e.text, tokens].filter(Boolean).join(" ").slice(0, 4096);
}
