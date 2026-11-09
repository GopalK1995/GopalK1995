// X-Razorpay-Signature on deliveries, through the real receiver (verify/receive.ts) with the published-schema fixtures.
import { describe, expect, it } from "vitest";
import { memoryStore, rateLimit } from "@/lib/security/rate-limit";
import { receivePost, type InboundConnection, type InboxStore, type NewInbox, type ReceiveDeps, type ReceiveReq } from "../../verify/receive";
import { schemeFor, VERIFIERS } from "../../verify";
import * as F from "../__fixtures__/payloads";
import { signRazorpayBody } from "../sign";

const CONN = "5f0c1d52-8a7e-4b1c-9d3e-0a1b2c3d4e5f", SECRET = "whsec-value-123";
const rows: NewInbox[] = [];
const store: InboxStore = {
  async getConnection(): Promise<InboundConnection> { return { id: CONN, tenantId: "t-1", workspaceId: "w-1", connectorId: "razorpay", status: "connected", webhookSecretId: null, credentialSecretId: "cred-1" }; },
  async insertInbox(n) { if (rows.some((r) => r.providerEventId === n.providerEventId)) return { id: null, duplicate: true }; rows.push(n); return { id: rows.length, duplicate: false }; },
  async deleteInbox() {},
};
const rl = memoryStore();
const deps = (): ReceiveDeps => ({
  store, enabled: true, now: () => 1_700_000_000_000, usable: () => true,
  // the credential bundle the connector stores: webhook_secret signs deliveries; key_secret must never be picked as the signing secret
  getSecret: async () => JSON.stringify({ key_id: "rzp_test_abcdef123", key_secret: "key-secret-NOT-for-signing", webhook_secret: SECRET }),
  rate: (s, i, c) => Promise.resolve(rateLimit(s, i, c, { store: rl, now: 1 })), enqueue: async () => {}, log: { warn() {}, error() {} },
});
const req = (body: string, headers: Record<string, string>): ReceiveReq => {
  const url = `https://app.test/api/hooks/razorpay/${CONN}`;
  return { method: "POST", connector: "razorpay", connection: CONN, url, query: new URL(url).searchParams, contentLength: null, ip: "9.9.9.9", readBody: async () => body, headers: new Headers(headers) };
};

describe("Razorpay webhook signature", () => {
  it("razorpay uses the razorpay scheme", () => { expect(schemeFor("razorpay")).toBe("razorpay"); });
  it("accepts a correctly signed fixture (webhook secret from the credential bundle) and stores it verified", async () => {
    rows.length = 0;
    const body = F.paymentLinkPaid();
    const r = await receivePost(deps(), req(body, { "x-razorpay-signature": signRazorpayBody(SECRET, body), "x-razorpay-event-id": "evt_1" }));
    expect(r.status).toBe(200);
    expect(rows[0]).toMatchObject({ signatureOk: true, connectorId: "razorpay", body, providerEventId: expect.stringContaining("evt_1") });
  });
  it("rejects a tampered body, a wrong secret, the key secret, a missing header and a malformed header with 401 and keeps no body", async () => {
    rows.length = 0;
    const body = F.paymentCaptured();
    const good = signRazorpayBody(SECRET, body);
    const cases: [string, string][] = [[body + " ", good], [body, signRazorpayBody("other-secret", body)], [body, signRazorpayBody("key-secret-NOT-for-signing", body)], [body, ""], [body, "zz"], [body, `sha256=${good}`]];
    for (const [b, h] of cases) {
      const r = await receivePost(deps(), req(b, h ? { "x-razorpay-signature": h } : {}));
      expect(r.status).toBe(401);
    }
    expect(rows.every((x) => x.signatureOk === false && x.body === null)).toBe(true);
  });
  it("accepts an upper-case hex digest (same bytes) and an empty secret never verifies", () => {
    const body = F.paymentFailed();
    const sig = signRazorpayBody(SECRET, body);
    expect(VERIFIERS.razorpay(body, new Headers({ "x-razorpay-signature": sig.toUpperCase() }), SECRET)).toBe(true);
    expect(VERIFIERS.razorpay(body, new Headers({ "x-razorpay-signature": sig }), "")).toBe(false);
  });
  it("a redelivery with the same X-Razorpay-Event-Id is a duplicate", async () => {
    rows.length = 0;
    const body = F.paymentCaptured();
    const h = { "x-razorpay-signature": signRazorpayBody(SECRET, body), "x-razorpay-event-id": "evt_dup" };
    expect((await receivePost(deps(), req(body, h))).json).toEqual({ ok: true });
    expect((await receivePost(deps(), req(body, h))).json).toEqual({ ok: true, duplicate: true });
  });
});
