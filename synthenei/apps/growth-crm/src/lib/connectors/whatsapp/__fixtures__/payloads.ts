// Webhook fixtures in the shape documented for the WhatsApp Cloud API ("messages" and "message_template_status_update" fields).
// Built from the published schema with synthetic ids and numbers; they are NOT captures from a live Meta account.
export const PNID = "100000000000001", WABA = "200000000000002", WA_ID = "919800000001", DISPLAY = "15550000001";

const wrap = (value: unknown, field = "messages") => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field, value }] }] });
const meta = { messaging_product: "whatsapp", display_phone_number: DISPLAY, phone_number_id: PNID };
const contacts = [{ profile: { name: "Test Customer" }, wa_id: WA_ID }];
const ts = "1767225600"; // 2026-01-01T00:00:00Z

export const textMessage = (body = "Hello there", id = "wamid.IN1", extra: Record<string, unknown> = {}) =>
  wrap({ metadata: meta, contacts, messages: [{ from: WA_ID, id, timestamp: ts, type: "text", text: { body }, ...extra }] });
export const imageMessage = (id = "wamid.IN2") =>
  wrap({ metadata: meta, contacts, messages: [{ from: WA_ID, id, timestamp: ts, type: "image", image: { caption: "the document", mime_type: "image/jpeg", sha256: "abc123", id: "media-1" } }] });
export const audioMessage = () => wrap({ metadata: meta, contacts, messages: [{ from: WA_ID, id: "wamid.IN3", timestamp: ts, type: "audio", audio: { mime_type: "audio/ogg; codecs=opus", sha256: "def", id: "media-2", voice: true } }] });
export const documentMessage = () => wrap({ metadata: meta, contacts, messages: [{ from: WA_ID, id: "wamid.IN4", timestamp: ts, type: "document", document: { filename: "brief.pdf", mime_type: "application/pdf", sha256: "ghi", id: "media-3" } }] });
export const locationMessage = () => wrap({ metadata: meta, contacts, messages: [{ from: WA_ID, id: "wamid.IN5", timestamp: ts, type: "location", location: { latitude: 12.97, longitude: 77.59, name: "Office", address: "Main Road" } }] });
export const buttonReply = () => wrap({ metadata: meta, contacts, messages: [{ from: WA_ID, id: "wamid.IN6", timestamp: ts, type: "interactive", interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes please" } } }] });
export const reaction = () => wrap({ metadata: meta, contacts, messages: [{ from: WA_ID, id: "wamid.IN7", timestamp: ts, type: "reaction", reaction: { message_id: "wamid.OUT1", emoji: "+1" } }] });
export const unsupported = () => wrap({ metadata: meta, contacts, messages: [{ from: WA_ID, id: "wamid.IN8", timestamp: ts, type: "order", order: {} }] });
export const clickToWhatsApp = () => textMessage("Hi, I saw your ad", "wamid.IN9", { referral: { source_url: "https://ads.example/post/1", source_id: "ad-123", source_type: "ad", headline: "A headline", ctwa_clid: "clid-xyz" } });
export const stopMessage = (word = "STOP", id = "wamid.IN10") => textMessage(word, id);

export const status = (st: "sent" | "delivered" | "read" | "failed", wamid = "wamid.OUT1", t = ts, errors?: unknown[]) =>
  wrap({ metadata: meta, statuses: [{ id: wamid, status: st, timestamp: t, recipient_id: WA_ID, ...(st === "sent" ? { pricing: { billable: true, pricing_model: "CBP", category: "utility" } } : {}), ...(errors ? { errors } : {}) }] });
export const failedStatus = () => status("failed", "wamid.OUT1", ts, [{ code: 131047, title: "Re-engagement message", message: "Re-engagement message", error_data: { details: "More than 24 hours have passed since the customer last replied." } }]);
export const templateStatus = (event = "APPROVED", reason?: string) =>
  wrap({ event, message_template_id: 9001, message_template_name: "sample_followup", message_template_language: "en", ...(reason ? { reason } : {}) }, "message_template_status_update");
export const otherNumber = () => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: WABA, changes: [{ field: "messages", value: { metadata: { ...meta, phone_number_id: "999999999999999" }, contacts, messages: [{ from: WA_ID, id: "wamid.INX", timestamp: ts, type: "text", text: { body: "hi" } }] } }] }] });
