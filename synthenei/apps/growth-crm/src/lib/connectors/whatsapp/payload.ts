// Webhook payload mappers: Meta WhatsApp Cloud API JSON -> typed events. Pure, defensive, never throws: anything that does not
// match the documented shape is dropped (and counted by the caller as rejected), never half-parsed. No PII is logged here.
export type WaMediaKind = "image" | "video" | "audio" | "document" | "sticker";
export type WaStatus = "sent" | "delivered" | "read" | "failed";

export interface WaReferral { sourceUrl?: string; sourceId?: string; sourceType?: string; headline?: string; ctwaClid?: string }
export interface WaMedia { kind: WaMediaKind; mediaId: string; mime?: string; sha256?: string; caption?: string; filename?: string; voice?: boolean }
export interface WaInboundMessage {
  wamid: string; from: string; at: string;
  type: "text" | "media" | "location" | "contacts" | "reply" | "reaction" | "unsupported";
  text?: string; media?: WaMedia;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contactsCount?: number;
  reply?: { kind: "button" | "list"; id?: string; title: string };
  reaction?: { emoji?: string; toWamid: string };
  referral?: WaReferral; replyToWamid?: string;
}
export interface WaError { code: number; title?: string; detail?: string }

export type WaEvent =
  | { kind: "message"; phoneNumberId: string; displayPhone?: string; profileName?: string; message: WaInboundMessage }
  | { kind: "status"; phoneNumberId: string; wamid: string; status: WaStatus; at: string; recipient?: string; errors?: WaError[]; pricingCategory?: string }
  | { kind: "template_status"; wabaId?: string; providerTemplateId: string; name?: string; language?: string; status: string; reason?: string };

type R = Record<string, unknown>;
const isObj = (v: unknown): v is R => !!v && typeof v === "object" && !Array.isArray(v);
const s = (v: unknown, max = 4096): string | undefined => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Meta timestamps are unix seconds, as a string. Falls back to `fallback` for anything unparseable. */
export function isoFromUnix(v: unknown, fallback: string): string {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : fallback;
}
const digits = (v: unknown): string | undefined => { const x = s(v, 32)?.replace(/\D/g, ""); return x && x.length >= 6 && x.length <= 20 ? x : undefined; };

const MEDIA_KINDS: WaMediaKind[] = ["image", "video", "audio", "document", "sticker"];

export function parseReferral(v: unknown): WaReferral | undefined {
  if (!isObj(v)) return undefined;
  const r: WaReferral = { sourceUrl: s(v.source_url, 500), sourceId: s(v.source_id, 100), sourceType: s(v.source_type, 20), headline: s(v.headline, 300), ctwaClid: s(v.ctwa_clid, 500) };
  return Object.values(r).some(Boolean) ? r : undefined;
}

export function parseMessage(m: unknown, fallbackAt: string): WaInboundMessage | null {
  if (!isObj(m)) return null;
  const wamid = s(m.id, 200), from = digits(m.from), type = s(m.type, 30);
  if (!wamid || !from || !type) return null;
  const base = { wamid, from, at: isoFromUnix(m.timestamp, fallbackAt), referral: parseReferral(m.referral), replyToWamid: isObj(m.context) ? s(m.context.id, 200) : undefined };
  if (type === "text" && isObj(m.text)) { const body = s(m.text.body); return body ? { ...base, type: "text", text: body } : null; }
  if ((MEDIA_KINDS as string[]).includes(type) && isObj(m[type])) {
    const x = m[type] as R, mediaId = s(x.id, 200);
    if (!mediaId) return null;
    return { ...base, type: "media", media: { kind: type as WaMediaKind, mediaId, mime: s(x.mime_type, 100), sha256: s(x.sha256, 100), caption: s(x.caption, 1024), filename: s(x.filename, 200), voice: x.voice === true ? true : undefined } };
  }
  if (type === "location" && isObj(m.location) && typeof m.location.latitude === "number" && typeof m.location.longitude === "number") {
    return { ...base, type: "location", location: { latitude: m.location.latitude, longitude: m.location.longitude, name: s(m.location.name, 200), address: s(m.location.address, 300) } };
  }
  if (type === "contacts") return { ...base, type: "contacts", contactsCount: arr(m.contacts).length };
  if (type === "button" && isObj(m.button)) { const t = s(m.button.text, 200); return t ? { ...base, type: "reply", reply: { kind: "button", title: t, id: s(m.button.payload, 200) } } : null; }
  if (type === "interactive" && isObj(m.interactive)) {
    const i = m.interactive;
    const kind = i.type === "list_reply" ? "list" : i.type === "button_reply" ? "button" : null;
    const inner = kind && isObj(i[i.type as string]) ? (i[i.type as string] as R) : null;
    const title = inner ? s(inner.title, 200) : undefined;
    return kind && title ? { ...base, type: "reply", reply: { kind, title, id: s(inner?.id, 200) } } : { ...base, type: "unsupported" };
  }
  if (type === "reaction" && isObj(m.reaction)) { const to = s(m.reaction.message_id, 200); return to ? { ...base, type: "reaction", reaction: { emoji: s(m.reaction.emoji, 20), toWamid: to } } : null; }
  return { ...base, type: "unsupported" };
}

const STATUSES: WaStatus[] = ["sent", "delivered", "read", "failed"];
export function parseStatus(x: unknown, phoneNumberId: string, fallbackAt: string): WaEvent | null {
  if (!isObj(x)) return null;
  const wamid = s(x.id, 200), st = s(x.status, 20);
  if (!wamid || !st || !(STATUSES as string[]).includes(st)) return null;
  const errors = arr(x.errors).filter(isObj).map((e): WaError => ({ code: typeof e.code === "number" ? e.code : 0, title: s(e.title, 200), detail: s(isObj(e.error_data) ? e.error_data.details : undefined, 300) ?? s(e.message, 300) }));
  return { kind: "status", phoneNumberId, wamid, status: st as WaStatus, at: isoFromUnix(x.timestamp, fallbackAt), recipient: digits(x.recipient_id), errors: errors.length ? errors : undefined, pricingCategory: isObj(x.pricing) ? s(x.pricing.category, 40) : undefined };
}

/** Parses one signed delivery body. `nowIso` is the fallback timestamp for messages that carry none. */
export function parseWebhook(raw: string, nowIso: string = new Date().toISOString()): WaEvent[] {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return []; }
  if (!isObj(j) || j.object !== "whatsapp_business_account") return [];
  const out: WaEvent[] = [];
  for (const entry of arr(j.entry)) {
    if (!isObj(entry)) continue;
    for (const ch of arr(entry.changes)) {
      if (!isObj(ch) || !isObj(ch.value)) continue;
      const v = ch.value;
      if (ch.field === "messages") {
        const md = isObj(v.metadata) ? v.metadata : {};
        const phoneNumberId = s(md.phone_number_id, 64);
        if (!phoneNumberId) continue;
        const names = new Map<string, string>();
        for (const c of arr(v.contacts)) if (isObj(c)) { const id = digits(c.wa_id), n = isObj(c.profile) ? s(c.profile.name, 200) : undefined; if (id && n) names.set(id, n); }
        for (const m of arr(v.messages)) { const message = parseMessage(m, nowIso); if (message) out.push({ kind: "message", phoneNumberId, displayPhone: s(md.display_phone_number, 32), profileName: names.get(message.from), message }); }
        for (const st of arr(v.statuses)) { const e = parseStatus(st, phoneNumberId, nowIso); if (e) out.push(e); }
      } else if (ch.field === "message_template_status_update") {
        const id = v.message_template_id === undefined || v.message_template_id === null ? undefined : s(String(v.message_template_id), 100), ev = s(v.event, 40);
        if (id && ev) out.push({ kind: "template_status", wabaId: s(entry.id, 64), providerTemplateId: id, name: s(v.message_template_name, 200), language: s(v.message_template_language, 20), status: ev, reason: s(v.reason, 300) });
      }
    }
  }
  return out;
}

/** Text stored in messages.body for an inbound message: the text itself, a caption, or a short bracket token (never prose). */
export function bodyOf(m: WaInboundMessage): string {
  switch (m.type) {
    case "text": return m.text ?? "";
    case "media": return m.media?.caption ?? `[${m.media?.kind ?? "media"}]`;
    case "location": return ["[location]", m.location?.name, m.location?.address].filter(Boolean).join(" ");
    case "contacts": return "[contact card]";
    case "reply": return m.reply?.title ?? "";
    default: return "[unsupported message]";
  }
}
