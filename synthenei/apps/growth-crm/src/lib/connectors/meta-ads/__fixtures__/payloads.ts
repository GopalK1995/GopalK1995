// Webhook bodies in the shape of Meta's published schema (leadgen change on a Page; Instagram messaging). Ids are synthetic.
export const PAGE = "111111111111111", IG = "222222222222222", SENDER = "333333333333333", LEADGEN = "444444444444444", FORM = "555555555555555";
export const leadgenBody = (o: { leadgen?: string; page?: string } = {}): string => JSON.stringify({
  object: "page",
  entry: [{ id: o.page ?? PAGE, time: 1700000000, changes: [{ field: "leadgen", value: { leadgen_id: o.leadgen ?? LEADGEN, page_id: o.page ?? PAGE, form_id: FORM, adgroup_id: "666", ad_id: "777", created_time: 1700000000 } }] }],
});
export const igBody = (o: { mid?: string; text?: string; echo?: boolean; igUser?: string; ts?: number } = {}): string => JSON.stringify({
  object: "instagram",
  entry: [{ id: o.igUser ?? IG, time: 1700000000000, messaging: [{ sender: { id: o.echo ? (o.igUser ?? IG) : SENDER }, recipient: { id: o.echo ? SENDER : (o.igUser ?? IG) }, timestamp: o.ts ?? 1700000000000, message: { mid: o.mid ?? "mid.AAA", text: o.text ?? "Hello", ...(o.echo ? { is_echo: true } : {}) } }] }],
});
/** A Graph lead object (GET /{leadgen_id}). */
export const graphLead = (extra: Record<string, unknown> = {}) => ({
  id: LEADGEN, created_time: "2023-11-14T22:13:20+0000", ad_id: "777", ad_name: "Ad one", adset_id: "666", adset_name: "Set one", campaign_id: "888", campaign_name: "Camp one", form_id: FORM, is_organic: false, platform: "fb",
  field_data: [{ name: "full_name", values: ["Asha Rao"] }, { name: "email", values: ["Asha@Example.COM"] }, { name: "phone_number", values: ["+919876543210"] }, { name: "city", values: ["Chennai"] }, { name: "consent_whatsapp", values: ["yes"] }],
  ...extra,
});
export const insightRow = (o: Record<string, unknown> = {}) => ({
  campaign_id: "888", campaign_name: "Camp one", date_start: "2026-11-01", date_stop: "2026-11-01", account_currency: "INR", spend: "1234.567", impressions: "10000", reach: "8000", clicks: "150",
  actions: [{ action_type: "lead", value: "4" }, { action_type: "onsite_conversion.lead_grouped", value: "4" }, { action_type: "post_reaction", value: "12" }, { action_type: "comment", value: "3" }, { action_type: "post", value: "2" }], ...o,
});
