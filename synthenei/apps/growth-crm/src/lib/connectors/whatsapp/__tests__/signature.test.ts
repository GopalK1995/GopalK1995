// X-Hub-Signature-256 on WhatsApp deliveries, through the real receiver (verify/receive.ts) with the recorded-shape fixtures.
import { describe, expect, it } from "vitest";
import { memoryStore, rateLimit } from "@/lib/security/rate-limit";
import { receivePost, type InboundConnection, type InboxStore, type NewInbox, type ReceiveDeps, type ReceiveReq } from "../../verify/receive";
import { schemeFor, VERIFIERS } from "../../verify";
import * as F from "../__fixtures__/payloads";
import { signMetaBody } from "../sign";

const CONN = "5f0c1d52-8a7e-4b1c-9d3e-0a1b2c3d4e5f", SECRET = "app-secret-value-123";
const rows: NewInbox[] = [];
const store: InboxStore = {
  async getConnection(): Promise<InboundConnection> { return { id: CONN, tenantId: "t-1", workspaceId: "w-1", connectorId: "whatsapp", status: "connected", webhookSecretId: null, credentialSecretId: "cred-1" }; },
  async insertInbox(n) { if (rows.some((r) => r.providerEventId === n.providerEventId)) return { id: null, duplicate: true }; rows.push(n); return { id: rows.length, duplicate: false }; },
  async deleteInbox() {},
};
const rl = memoryStore();
const deps = (): ReceiveDeps => ({
  store, enabled: true, now: () => 1_700_000_000_000, usable: () => true,
  // the credential bundle the connector stores: app_secret is picked as the signing secret when no webhook secret exists
  getSecret: async () => JSON.stringify({ waba_id: F.WABA, phone_number_id: F.PNID, access_token: "tok", app_secret: SECRET }),
  rate: (s, i, c) => Promise.resolve(rateLimit(s, i, c, { store: rl, now: 1 })), enqueue: async () => {}, log: { warn() {}, error() {} },
});
const req = (body: string, headers: Record<string, string>): ReceiveReq => {
  const url = `https://app.test/api/hooks/whatsapp/${CONN}`;
  return { method: "POST", connector: "whatsapp", connection: CONN, url, query: new URL(url).searchParams, contentLength: null, ip: "9.9.9.9", readBody: async () => body, headers: new Headers(headers) };
};

describe("WhatsApp webhook signature", () => {
  it("whatsapp uses the Meta scheme", () => { expect(schemeFor("whatsapp")).toBe("meta"); });
  it("accepts a correctly signed fixture (app secret from the credential bundle) and stores it verified", async () => {
    rows.length = 0;
    const body = F.textMessage();
    const r = await receivePost(deps(), req(body, { "x-hub-signature-256": signMetaBody(SECRET, body) }));
    expect(r.status).toBe(200);
    expect(rows[0]).toMatchObject({ signatureOk: true, connectorId: "whatsapp", body });
  });
  it("rejects a tampered body, a wrong secret, a missing header and a malformed header with 401 and stores nothing verified", async () => {
    rows.length = 0;
    const body = F.textMessage();
    const good = signMetaBody(SECRET, body);
    for (const [b, h] of [[body + " ", good], [body, signMetaBody("other-secret", body)], [body, ""], [body, "sha256=zz"], [body, good.replace("sha256=", "sha1=")]] as const) {
      const r = await receivePost(deps(), req(b, h ? { "x-hub-signature-256": h } : {}));
      expect(r.status).toBe(401);
    }
    expect(rows.every((x) => x.signatureOk === false && x.body === null)).toBe(true);
  });
  it("accepts an upper-case hex digest (same bytes) and compares in constant time", () => {
    const body = F.status("read");
    const sig = signMetaBody(SECRET, body);
    const up = "sha256=" + sig.slice(7).toUpperCase();
    expect(VERIFIERS.meta(body, new Headers({ "x-hub-signature-256": up }), SECRET)).toBe(true);
    expect(VERIFIERS.meta(body, new Headers({ "x-hub-signature-256": sig }), "")).toBe(false);
  });
  it("a redelivery of the same signed body is a duplicate (wamid dedupe happens again downstream)", async () => {
    rows.length = 0;
    const body = F.status("delivered");
    const h = { "x-hub-signature-256": signMetaBody(SECRET, body) };
    expect((await receivePost(deps(), req(body, h))).json).toEqual({ ok: true });
    expect((await receivePost(deps(), req(body, h))).json).toEqual({ ok: true, duplicate: true });
  });
});
