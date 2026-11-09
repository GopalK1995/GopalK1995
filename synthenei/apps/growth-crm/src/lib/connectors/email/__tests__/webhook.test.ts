// Resend webhooks: Svix signature through the REAL receiver, event parsing, and the effects (delivery status, suppression, consent).
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { memoryStore, rateLimit } from "@/lib/security/rate-limit";
import { receivePost, type InboundConnection, type InboxStore, type NewInbox, type ReceiveDeps, type ReceiveReq } from "../../verify/receive";
import { schemeFor } from "../../verify";
import { handleEmailEvent, parseResendEvent, WebhookParseError } from "../webhook";
import { FakeStore } from "./fake";

const CONN = "7b0c1d52-8a7e-4b1c-9d3e-0a1b2c3d4e5f", KEY = Buffer.from("unit-test-svix-key-bytes-0123456789").toString("base64"), SECRET = `whsec_${KEY}`;
const NOW = 1_800_000_000_000;
const sign = (id: string, ts: number, body: string, key = KEY) => `v1,${createHmac("sha256", Buffer.from(key, "base64")).update(`${id}.${ts}.${body}`).digest("base64")}`;

const rows: NewInbox[] = [];
const store: InboxStore = {
  async getConnection(): Promise<InboundConnection> { return { id: CONN, tenantId: "t1", workspaceId: "w1", connectorId: "resend", status: "connected", webhookSecretId: null, credentialSecretId: "cred-1" }; },
  async insertInbox(n) { if (rows.some((r) => r.providerEventId === n.providerEventId)) return { id: null, duplicate: true }; rows.push(n); return { id: rows.length, duplicate: false }; },
  async deleteInbox() {},
};
const rl = memoryStore();
const deps = (): ReceiveDeps => ({
  store, enabled: true, now: () => NOW, usable: () => true,
  // the bundle the connector stores: webhook_secret is added on /settings/email after Resend shows it
  getSecret: async () => JSON.stringify({ api_key: "re_xxxxxxxxxx", webhook_secret: SECRET }),
  rate: (s, i, c) => Promise.resolve(rateLimit(s, i, c, { store: rl, now: 1 })), enqueue: async () => {}, log: { warn() {}, error() {} },
});
const req = (body: string, h: Record<string, string>): ReceiveReq => {
  const url = `https://app.test/api/hooks/resend/${CONN}`;
  return { method: "POST", connector: "resend", connection: CONN, url, query: new URL(url).searchParams, contentLength: null, ip: "9.9.9.9", readBody: async () => body, headers: new Headers(h) };
};
const evt = (type: string, data: Record<string, unknown>) => JSON.stringify({ type, created_at: "2026-11-01T10:00:00.000Z", data: { email_id: "re_msg_1", to: ["Asha@Example.com"], ...data } });

describe("Resend webhook signature (Svix) through the real receiver", () => {
  const ts = Math.floor(NOW / 1000), id = "msg_2abc";
  it("resend uses the svix scheme", () => { expect(schemeFor("resend")).toBe("svix"); });
  it("accepts a correctly signed delivery, dedupes on svix-id", async () => {
    rows.length = 0;
    const body = evt("email.delivered", {});
    const h = { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": sign(id, ts, body) };
    expect((await receivePost(deps(), req(body, h))).status).toBe(200);
    expect(rows[0]).toMatchObject({ signatureOk: true, connectorId: "resend", providerEventId: expect.stringContaining(id) });
    const again = await receivePost(deps(), req(body, h));
    expect(again.status).toBe(200);
    expect(rows).toHaveLength(1);
  });
  it("rejects a tampered body, a wrong key, a stale timestamp and missing or malformed headers", async () => {
    rows.length = 0;
    const body = evt("email.bounced", { bounce: { type: "Permanent" } });
    const good = { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": sign(id, ts, body) };
    expect((await receivePost(deps(), req(body + " ", good))).status).toBe(401);
    expect((await receivePost(deps(), req(body, { ...good, "svix-signature": sign(id, ts, body, Buffer.from("another-key").toString("base64")) }))).status).toBe(401);
    const old = ts - 3600;
    expect((await receivePost(deps(), req(body, { "svix-id": id, "svix-timestamp": String(old), "svix-signature": sign(id, old, body) }))).status).toBe(401);
    expect((await receivePost(deps(), req(body, { "svix-id": id, "svix-timestamp": String(ts) }))).status).toBe(401);
    expect((await receivePost(deps(), req(body, { ...good, "svix-signature": "garbage" }))).status).toBe(401);
    expect((await receivePost(deps(), req(body, {}))).status).toBe(401);
    expect(rows.filter((r) => r.signatureOk)).toHaveLength(0);
  });
  it("accepts when one of several space-separated signatures is valid (key rotation)", async () => {
    rows.length = 0;
    const body = evt("email.delivered", {});
    const sig = `v1,AAAA ${sign("msg_rot", ts, body)}`;
    expect((await receivePost(deps(), req(body, { "svix-id": "msg_rot", "svix-timestamp": String(ts), "svix-signature": sig }))).status).toBe(200);
  });
});

describe("parseResendEvent", () => {
  it("maps provider types, hard vs soft bounces and ignores unknown types", () => {
    expect(parseResendEvent(evt("email.delivered", {}))).toMatchObject({ event: { kind: "delivered" }, providerId: "re_msg_1", to: "Asha@Example.com" });
    expect(parseResendEvent(evt("email.bounced", { bounce: { type: "Permanent", subType: "General" } }))?.event).toEqual({ kind: "bounced", hard: true });
    expect(parseResendEvent(evt("email.bounced", { bounce: { type: "Transient" } }))?.event).toEqual({ kind: "bounced", hard: false });
    expect(parseResendEvent(evt("email.bounced", {}))?.event).toEqual({ kind: "bounced", hard: false });
    expect(parseResendEvent(evt("email.complained", {}))?.event).toEqual({ kind: "complained" });
    expect(parseResendEvent(evt("contact.created", {}))).toBeNull();
    expect(() => parseResendEvent("not json")).toThrow(WebhookParseError);
    expect(() => parseResendEvent("[1")).toThrow(WebhookParseError);
  });
});

describe("applying events", () => {
  function setup() {
    const s = new FakeStore(); s.addLead("l1", "w1", "asha@example.com");
    s.queue({ id: "m1", status: "sent", providerId: "re_msg_1" });
    const ctx = { store: s, scope: { tenantId: "t1", workspaceId: "w1", connectionId: "c1" }, now: () => new Date("2026-11-02T00:00:00Z"), reject: (r: string) => { rejected.push(r); } };
    const rejected: string[] = [];
    return { s, ctx, rejected, run: (raw: string) => handleEmailEvent(ctx, parseResendEvent(raw)!) };
  }
  it("delivered moves the message forward, never backwards on a replay of an older event", async () => {
    const { s, run } = setup();
    await run(evt("email.delivered", {}));
    expect(s.msgs[0].status).toBe("delivered");
    await run(evt("email.sent", {}));
    expect(s.msgs[0].status).toBe("delivered");
  });
  it("a hard bounce fails the message and suppresses the address; consent is NOT withdrawn", async () => {
    const { s, run } = setup();
    await run(evt("email.bounced", { bounce: { type: "Permanent" } }));
    expect(s.msgs[0]).toMatchObject({ status: "failed", errorCode: "hard_bounce" });
    expect(s.suppressed).toHaveLength(1);
    expect(s.suppressed[0]).toMatchObject({ email: "asha@example.com", reason: "hard_bounce", workspaceId: "w1" });
    expect(s.consent.filter((c) => c.action === "withdrawn")).toHaveLength(0);
    expect(s.events.map((e) => e.type)).toContain("email.bounced");
  });
  it("a soft bounce suppresses nothing", async () => {
    const { s, run } = setup();
    await run(evt("email.bounced", { bounce: { type: "Transient" } }));
    await run(evt("email.delivery_delayed", {}));
    expect(s.suppressed).toHaveLength(0);
    expect(s.msgs[0].status).toBe("sent");
  });
  it("a complaint suppresses and writes a consent withdrawal, so can_contact turns false", async () => {
    const { s, run } = setup();
    expect(await s.canContact("l1")).toBe(true);
    await run(evt("email.complained", {}));
    expect(s.suppressed[0]).toMatchObject({ reason: "complaint" });
    expect(s.consent.at(-1)).toMatchObject({ action: "withdrawn", leadId: "l1" });
    expect(await s.canContact("l1")).toBe(false);
    expect(s.events.map((e) => e.type)).toContain("email.complained");
  });
  it("is idempotent: replaying a complaint or bounce adds no second suppression or consent row", async () => {
    const { s, run } = setup();
    await run(evt("email.complained", {})); await run(evt("email.complained", {}));
    await run(evt("email.bounced", { bounce: { type: "Permanent" } })); await run(evt("email.bounced", { bounce: { type: "Permanent" } }));
    expect(s.suppressed).toHaveLength(1);
    expect(s.consent.filter((c) => c.action === "withdrawn")).toHaveLength(1);
  });
  it("only touches this connection's tenant: an event for another tenant's message id is rejected, status untouched", async () => {
    const { s, ctx, rejected } = setup();
    s.queue({ id: "m2", tenantId: "t2", workspaceId: "w2", providerId: "re_other", status: "sent", email: "x@other.test" });
    await handleEmailEvent(ctx, parseResendEvent(evt("email.delivered", { email_id: "re_other", to: ["x@other.test"] }))!);
    expect(rejected).toEqual(["unknown_message"]);
    expect(s.msgs.find((m) => m.id === "m2")!.status).toBe("sent");
  });
  it("suppresses by the event's address when the message is unknown (sent outside the CRM)", async () => {
    const { s, run } = setup();
    await run(evt("email.complained", { email_id: "re_unknown", to: ["stranger@example.net"] }));
    expect(await s.isSuppressed("w1", "stranger@example.net")).toBe(true);
    expect(s.consent.at(-1)).toMatchObject({ action: "withdrawn", leadId: null });
  });
});
