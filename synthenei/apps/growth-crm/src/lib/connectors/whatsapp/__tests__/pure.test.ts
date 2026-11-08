import { describe, expect, it } from "vitest";
import * as F from "../__fixtures__/payloads";
import { bodyOf, parseWebhook, type WaEvent } from "../payload";
import { isOptOut } from "../optout";
import { serviceWindow, toMs } from "../window";
import { extractTemplateParams, localLanguage, mapStatus, syncTemplates, variablesOf } from "../templates";
import { MOCK_TEMPLATES } from "../mock";
import { FakeStore, fakeDeps } from "./fake-store";

const msgs = (raw: string) => parseWebhook(raw, "2026-01-01T00:00:00.000Z").filter((e): e is Extract<WaEvent, { kind: "message" }> => e.kind === "message");

describe("payload mappers (fixtures in the documented Cloud API shape)", () => {
  it("text message with profile name, timestamp and phone number id", () => {
    const [e] = msgs(F.textMessage("Hello there"));
    expect(e).toMatchObject({ phoneNumberId: F.PNID, profileName: "Test Customer", message: { wamid: "wamid.IN1", from: F.WA_ID, type: "text", text: "Hello there", at: "2026-01-01T00:00:00.000Z" } });
  });
  it("image keeps caption, mime, hash and media id (reference only, no bytes)", () => {
    const [e] = msgs(F.imageMessage());
    expect(e.message.media).toEqual({ kind: "image", mediaId: "media-1", mime: "image/jpeg", sha256: "abc123", caption: "the document", filename: undefined, voice: undefined });
    expect(bodyOf(e.message)).toBe("the document");
  });
  it("audio (voice note) and document map to media with a bracket token when there is no caption", () => {
    const [a] = msgs(F.audioMessage()), [d] = msgs(F.documentMessage());
    expect(a.message.media).toMatchObject({ kind: "audio", voice: true });
    expect(bodyOf(a.message)).toBe("[audio]");
    expect(d.message.media).toMatchObject({ kind: "document", filename: "brief.pdf" });
  });
  it("location, button reply, reaction and unknown types", () => {
    expect(msgs(F.locationMessage())[0].message).toMatchObject({ type: "location", location: { latitude: 12.97, name: "Office" } });
    expect(bodyOf(msgs(F.locationMessage())[0].message)).toBe("[location] Office Main Road");
    expect(msgs(F.buttonReply())[0].message).toMatchObject({ type: "reply", reply: { kind: "button", title: "Yes please", id: "yes" } });
    expect(msgs(F.reaction())[0].message).toMatchObject({ type: "reaction", reaction: { toWamid: "wamid.OUT1" } });
    expect(msgs(F.unsupported())[0].message.type).toBe("unsupported");
  });
  it("click-to-WhatsApp referral is carried", () => {
    expect(msgs(F.clickToWhatsApp())[0].message.referral).toEqual({ sourceUrl: "https://ads.example/post/1", sourceId: "ad-123", sourceType: "ad", headline: "A headline", ctwaClid: "clid-xyz" });
  });
  it("status callbacks: sent (with pricing category), delivered, read, failed (with vendor error)", () => {
    const s = (raw: string) => parseWebhook(raw)[0] as Extract<WaEvent, { kind: "status" }>;
    expect(s(F.status("sent"))).toMatchObject({ status: "sent", wamid: "wamid.OUT1", pricingCategory: "utility", recipient: F.WA_ID });
    expect(s(F.status("delivered")).status).toBe("delivered");
    expect(s(F.status("read")).status).toBe("read");
    const f = s(F.failedStatus());
    expect(f.status).toBe("failed");
    expect(f.errors?.[0]).toMatchObject({ code: 131047, title: "Re-engagement message" });
  });
  it("template status update", () => {
    expect(parseWebhook(F.templateStatus("REJECTED", "INVALID_FORMAT"))[0]).toMatchObject({ kind: "template_status", providerTemplateId: "9001", name: "sample_followup", language: "en", status: "REJECTED", reason: "INVALID_FORMAT" });
  });
  it("never throws on garbage and drops anything that does not match the schema", () => {
    for (const raw of ["", "not json", "null", "[]", "{}", '{"object":"page"}', '{"object":"whatsapp_business_account","entry":[null,{"changes":[{"field":"messages","value":{"messages":[{"id":"x"}]}}]}]}']) expect(parseWebhook(raw)).toEqual([]);
    expect(parseWebhook(JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1" }, messages: [{ id: "w", from: "12", type: "text", text: { body: "x" } }] } }] }] }))).toEqual([]);   // from too short
  });
  it("falls back to the supplied time when a timestamp is missing or invalid", () => {
    const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1" }, messages: [{ id: "w", from: "919800000001", type: "text", text: { body: "x" }, timestamp: "abc" }] } }] }] });
    expect((parseWebhook(raw, "2030-05-05T00:00:00.000Z")[0] as Extract<WaEvent, { kind: "message" }>).message.at).toBe("2030-05-05T00:00:00.000Z");
  });
});

describe("24 hour service window", () => {
  const last = "2026-01-01T10:00:00Z";
  it("open until exactly 24 h after the last inbound, closed at and after", () => {
    expect(serviceWindow(last, "2026-01-02T09:59:59Z")).toMatchObject({ open: true, leftMs: 1000 });
    expect(serviceWindow(last, "2026-01-02T10:00:00Z").open).toBe(false);
    expect(serviceWindow(last, "2026-01-03T00:00:00Z")).toEqual({ open: false, leftMs: 0 });
  });
  it("no inbound yet means closed (templates only)", () => {
    expect(serviceWindow(null, "2026-01-01T00:00:00Z").open).toBe(false);
    expect(serviceWindow(undefined, new Date()).open).toBe(false);
    expect(serviceWindow("garbage", new Date()).open).toBe(false);
  });
  it("an offset-less timestamp is UTC and an IST offset is honoured", () => {
    expect(toMs("2026-01-01 10:00:00")).toBe(Date.parse("2026-01-01T10:00:00Z"));
    expect(toMs("2026-01-01T15:30:00+05:30")).toBe(Date.parse("2026-01-01T10:00:00Z"));
    expect(serviceWindow("2026-01-01T15:30:00+05:30", "2026-01-02T09:00:00Z").open).toBe(true);
  });
});

describe("opt-out keywords", () => {
  it("matches whole-message keywords regardless of case, punctuation and script", () => {
    for (const t of ["STOP", " stop ", "Stop.", "STOP ALL", "Unsubscribe", "opt-out", "நிறுத்து", "बंद करो"]) expect(isOptOut(t), t).toBe(true);
  });
  it("does not match a keyword inside a sentence or unrelated text", () => {
    for (const t of ["please do not stop the updates", "stopping by tomorrow", "cancel my appointment", "", "ok", "bus stop near office"]) expect(isOptOut(t), t).toBe(false);
    expect(isOptOut(null)).toBe(false);
    expect(isOptOut("stop ".repeat(40))).toBe(false);
  });
});

describe("templates", () => {
  it("variables, languages and status mapping", () => {
    expect(variablesOf("Hi {{1}}, {{2}} and {{1}}")).toEqual(["1", "2"]);
    expect([localLanguage("en"), localLanguage("en_US"), localLanguage("ta"), localLanguage("hi")]).toEqual(["en", "en", "ta", null]);
    expect(mapStatus("APPROVED").status).toBe("approved");
    expect(mapStatus("PENDING").status).toBe("submitted");
    expect(mapStatus("IN_APPEAL").status).toBe("submitted");
    expect(mapStatus("PAUSED").status).toBe("paused");
    expect(mapStatus("REJECTED").approval).toBe("rejected");
  });
  it("recovers {{n}} values from a rendered body, English and Tamil", () => {
    expect(extractTemplateParams("Hello {{1}}, your visit is on {{2}}.", "Hello Asha, your visit is on Monday 5 pm.")).toEqual(["Asha", "Monday 5 pm"]);
    expect(extractTemplateParams("வணக்கம் {{1}}, நன்றி.", "வணக்கம் ஆஷா, நன்றி.")).toEqual(["ஆஷா"]);
    expect(extractTemplateParams("No variables here", "No variables here")).toEqual([]);
    expect(extractTemplateParams("Hello {{1}}.", "Something else entirely")).toBeNull();
    expect(extractTemplateParams("Hello {{1}}.", "Hello .")).toBeNull();
    expect(extractTemplateParams("Cost (approx.) {{1}}?", "Cost (approx.) 10?")).toEqual(["10"]);   // regex metacharacters in the template are literal
  });
  it("sync stores en/ta templates with the vendor language, skips unsupported languages and clashes, and is idempotent", async () => {
    const deps = fakeDeps();
    const rejected: string[] = [];
    const scope = { tenantId: "t-1", workspaceId: "w-1", connectionId: "c-1" };
    const list = [...MOCK_TEMPLATES, { id: "x1", name: "hindi_one", language: "hi", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "x" }] }, { id: "x2", name: "sample_followup", language: "en_US", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hi {{1}}" }] }];
    const r = await syncTemplates(deps, scope, list, (x) => rejected.push(x));
    expect(r).toEqual({ created: 3, updated: 0, skipped: 2 });
    expect(rejected.sort()).toEqual(["duplicate_language", "unsupported_language"]);
    expect(deps.store.templates.map((t) => `${t.name}/${t.language}/${t.status}/${t.category}`).sort()).toEqual(["sample_followup/en/approved/utility", "sample_followup/ta/approved/utility", "sample_offer/en/submitted/marketing"]);
    expect(deps.store.templates.find((t) => t.language === "ta")?.body).toContain("{{1}}");
    const again = await syncTemplates(deps, scope, MOCK_TEMPLATES, () => undefined);
    expect(again).toEqual({ created: 0, updated: 3, skipped: 0 });
    expect(new FakeStore().templates).toHaveLength(0);
  });
});
