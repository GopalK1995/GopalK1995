// Payload parsing (fixtures per Meta's schema) and X-Hub-Signature-256 through the real receiver (verify/receive.ts).
import { describe, expect, it } from "vitest";
import { memoryStore, rateLimit } from "@/lib/security/rate-limit";
import { schemeFor } from "../../verify";
import { receivePost, type InboundConnection, type InboxStore, type NewInbox, type ReceiveDeps, type ReceiveReq } from "../../verify/receive";
import { signMetaBody } from "../../whatsapp/sign";
import * as F from "../__fixtures__/payloads";
import { bodyOf, parseWebhook } from "../payload";

describe("parseWebhook", () => {
  it("parses a leadgen change", () => {
    expect(parseWebhook(F.leadgenBody())).toEqual([{ kind: "leadgen", pageId: F.PAGE, leadgenId: F.LEADGEN, formId: F.FORM, adId: "777", adgroupId: "666", at: "2023-11-14T22:13:20.000Z" }]);
  });
  it("parses an Instagram DM (timestamp in ms) and builds the inbox body", () => {
    const [e] = parseWebhook(F.igBody({ text: "Price?" }));
    expect(e).toMatchObject({ kind: "ig_message", igUserId: F.IG, senderId: F.SENDER, mid: "mid.AAA", text: "Price?", at: "2023-11-14T22:13:20.000Z" });
    expect(bodyOf(e as never)).toBe("Price?");
  });
  it("ignores echoes of our own messages, other objects, other fields and garbage", () => {
    expect(parseWebhook(F.igBody({ echo: true }))).toEqual([]);
    expect(parseWebhook(JSON.stringify({ object: "whatsapp_business_account", entry: [] }))).toEqual([]);
    expect(parseWebhook(JSON.stringify({ object: "page", entry: [{ changes: [{ field: "feed", value: {} }] }] }))).toEqual([]);
    expect(parseWebhook(JSON.stringify({ object: "page", entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "abc" } }] }] }))).toEqual([]);
    expect(parseWebhook("not json")).toEqual([]);
    expect(parseWebhook("null")).toEqual([]);
  });
  it("attachment-only DMs become bracket tokens", () => {
    const body = JSON.stringify({ object: "instagram", entry: [{ id: F.IG, messaging: [{ sender: { id: F.SENDER }, recipient: { id: F.IG }, timestamp: 1700000000000, message: { mid: "m2", attachments: [{ type: "image", payload: { url: "https://x.invalid/a" } }] } }] }] });
    const [e] = parseWebhook(body);
    expect(bodyOf(e as never)).toBe("[image]");
  });
});

const CONN = "5f0c1d52-8a7e-4b1c-9d3e-0a1b2c3d4e5f", SECRET = "app-secret-value-123";
const rows: NewInbox[] = [];
const store: InboxStore = {
  async getConnection(): Promise<InboundConnection> { return { id: CONN, tenantId: "t-1", workspaceId: "w-1", connectorId: "meta-ads", status: "connected", webhookSecretId: "hook-1", credentialSecretId: "cred-1" }; },
  async insertInbox(n) { if (rows.some((r) => r.providerEventId === n.providerEventId)) return { id: null, duplicate: true }; rows.push(n); return { id: rows.length, duplicate: false }; },
  async deleteInbox() {},
};
const rl = memoryStore();
const deps = (): ReceiveDeps => ({
  store, enabled: true, now: () => 1_700_000_000_000, usable: () => true,
  getSecret: async (id) => (id === "hook-1" ? JSON.stringify({ app_secret: SECRET, verify_token: "vt" }) : JSON.stringify({ access_token: "tok" })),
  rate: (s, i, c) => Promise.resolve(rateLimit(s, i, c, { store: rl, now: 1 })), enqueue: async () => {}, log: { warn() {}, error() {} },
});
const req = (body: string, headers: Record<string, string>): ReceiveReq => {
  const url = `https://app.test/api/hooks/meta-ads/${CONN}`;
  return { method: "POST", connector: "meta-ads", connection: CONN, url, query: new URL(url).searchParams, contentLength: null, ip: "9.9.9.9", readBody: async () => body, headers: new Headers(headers) };
};

describe("Meta webhook signature", () => {
  it("meta-ads uses the Meta scheme", () => { expect(schemeFor("meta-ads")).toBe("meta"); });
  it("accepts a correctly signed leadgen delivery (secret from the webhook bundle) and stores it verified", async () => {
    rows.length = 0;
    const body = F.leadgenBody();
    const r = await receivePost(deps(), req(body, { "x-hub-signature-256": signMetaBody(SECRET, body) }));
    expect(r.status).toBe(200);
    expect(rows[0]).toMatchObject({ signatureOk: true, connectorId: "meta-ads", body });
  });
  it("replay is a duplicate, never enqueued twice", async () => {
    rows.length = 0;
    const body = F.igBody();
    const h = { "x-hub-signature-256": signMetaBody(SECRET, body) };
    await receivePost(deps(), req(body, h));
    const again = await receivePost(deps(), req(body, h));
    expect(again.json).toMatchObject({ ok: true, duplicate: true });
  });
  it("rejects tampered body, wrong secret, missing header with 401 and stores nothing verified", async () => {
    rows.length = 0;
    const body = F.leadgenBody();
    const good = signMetaBody(SECRET, body);
    for (const r of [await receivePost(deps(), req(body + " ", { "x-hub-signature-256": good })), await receivePost(deps(), req(body, { "x-hub-signature-256": signMetaBody("other", body) })), await receivePost(deps(), req(body, {}))]) expect(r.status).toBe(401);
    expect(rows.every((r) => r.signatureOk === false)).toBe(true);
  });
});
