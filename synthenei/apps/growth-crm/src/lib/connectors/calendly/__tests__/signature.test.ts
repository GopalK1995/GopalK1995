// Calendly-Webhook-Signature and X-Cal-Signature-256 through the real receiver (verify/receive.ts), then the whole path
// (receiver -> stored body -> connector parse -> handler) against the in-memory store.
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryStore, rateLimit } from "@/lib/security/rate-limit";
import { receivePost, type InboundConnection, type InboxStore, type NewInbox, type ReceiveDeps, type ReceiveReq } from "../../verify/receive";
import { schemeFor } from "../../verify";
import { calcomConnector } from "../../calcom/connector";
import { calendlyConnector, setBookingRuntimeFactory } from "../connector";
import * as F from "./fixtures";
import { FakeStore, mkConn, mkDeps } from "./fake-store";

const CONN = "5f0c1d52-8a7e-4b1c-9d3e-0a1b2c3d4e5f", SECRET = "signing-key-0123456789abcdef", NOW = 1_800_000_000_000;
const hex = (key: string, data: string) => createHmac("sha256", key).update(data, "utf8").digest("hex");
const calendlySig = (body: string, key = SECRET, t = Math.floor(NOW / 1000)) => `t=${t},v1=${hex(key, `${t}.${body}`)}`;

let rows: NewInbox[];
const store = (connector: string): InboxStore => ({
  async getConnection(): Promise<InboundConnection> { return { id: CONN, tenantId: "t-1", workspaceId: "w-1", connectorId: connector, status: "connected", webhookSecretId: null, credentialSecretId: "cred-1" }; },
  async insertInbox(n) { if (rows.some((r) => r.providerEventId === n.providerEventId)) return { id: null, duplicate: true }; rows.push(n); return { id: rows.length, duplicate: false }; },
  async deleteInbox() {},
});
const rl = memoryStore();
// the credential bundles the connectors store: the signing secret is picked by key name, the vendor token must never be used to verify
const bundle = (connector: string) => JSON.stringify(connector === "calendly" ? { access_token: "token-NOT-for-signing", signing_key: SECRET } : { api_key: "key-NOT-for-signing", webhook_secret: SECRET });
const deps = (connector: string): ReceiveDeps => ({
  store: store(connector), enabled: true, now: () => NOW, usable: () => true, getSecret: async () => bundle(connector),
  rate: (s, i, c) => Promise.resolve(rateLimit(s, i, c, { store: rl, now: 1 })), enqueue: async () => {}, log: { warn() {}, error() {} },
});
const req = (connector: string, body: string, headers: Record<string, string>): ReceiveReq => {
  const url = `https://app.test/api/hooks/${connector}/${CONN}`;
  return { method: "POST", connector, connection: CONN, url, query: new URL(url).searchParams, contentLength: null, ip: "9.9.9.9", readBody: async () => body, headers: new Headers(headers) };
};
beforeEach(() => { rows = []; });

describe("Calendly signature", () => {
  it("uses the calendly scheme; Cal.com uses the calcom scheme (connector id cal-com)", () => { expect(schemeFor("calendly")).toBe("calendly"); expect(schemeFor("cal-com")).toBe("calcom"); });
  it("accepts a correctly signed delivery and stores it verified", async () => {
    const body = F.calendlyCreated();
    const r = await receivePost(deps("calendly"), req("calendly", body, { "calendly-webhook-signature": calendlySig(body) }));
    expect(r.status).toBe(200);
    expect(rows[0]).toMatchObject({ signatureOk: true, connectorId: "calendly", body });
  });
  it("rejects tampered body, wrong key, the access token, a stale timestamp, a missing and a malformed header with 401 and keeps no body", async () => {
    const body = F.calendlyCreated();
    const cases: string[] = [calendlySig(body + " "), calendlySig(body, "other-key-0123456789abcdef"), calendlySig(body, "token-NOT-for-signing"), calendlySig(body, SECRET, Math.floor(NOW / 1000) - 600), "", "v1=abc", "t=x,v1=y"];
    for (const h of cases) expect((await receivePost(deps("calendly"), req("calendly", i(body, h), h ? { "calendly-webhook-signature": h } : {}))).status).toBe(401);
    expect(rows.every((x) => x.signatureOk === false && x.body === null)).toBe(true);
  });
  it("a redelivery of the same body is a duplicate", async () => {
    const body = F.calendlyCreated(), h = { "calendly-webhook-signature": calendlySig(body) };
    expect((await receivePost(deps("calendly"), req("calendly", body, h))).json).toEqual({ ok: true });
    expect((await receivePost(deps("calendly"), req("calendly", body, h))).json).toEqual({ ok: true, duplicate: true });
  });
});
const i = (b: string, _h: string) => b;

describe("Cal.com signature", () => {
  it("accepts a correctly signed delivery (upper-case hex too) and rejects tampered, wrong-secret, the api key, and a missing header", async () => {
    const body = F.calCreated();
    expect((await receivePost(deps("cal-com"), req("cal-com", body, { "x-cal-signature-256": hex(SECRET, body) }))).status).toBe(200);
    expect(rows[0]).toMatchObject({ signatureOk: true, connectorId: "cal-com" });
    rows = [];
    expect((await receivePost(deps("cal-com"), req("cal-com", body, { "x-cal-signature-256": hex(SECRET, body).toUpperCase() }))).status).toBe(200);
    rows = [];
    for (const h of [hex(SECRET, body + " "), hex("other-secret-0123456789", body), hex("key-NOT-for-signing", body), ""]) {
      expect((await receivePost(deps("cal-com"), req("cal-com", body, h ? { "x-cal-signature-256": h } : {}))).status).toBe(401);
    }
    expect(rows.every((x) => x.signatureOk === false && x.body === null)).toBe(true);
  });
});

describe("through the connector (verified body -> parse -> handle)", () => {
  it("both connectors turn a verified body into a task and a notice for the matching lead, and a replay adds nothing", async () => {
    const st = new FakeStore();
    st.leads.push({ id: "lead-1", workspaceId: "ws-1", email: "pat.example@example.test", ownerId: "user-rep" });
    setBookingRuntimeFactory(async () => ({ deps: mkDeps(st) }));
    try {
      for (const [def, body] of [[calendlyConnector, F.calendlyCreated()], [calcomConnector, F.calCreated()]] as const) {
        const events = await def.webhook!.verify({ rawBody: body, headers: {} }, {});
        for (let n = 0; n < 2; n++) for (const e of events) await def.webhook!.handle({ conn: mkConn({ connectorId: def.id }) } as never, e);
      }
      expect(st.tasks).toHaveLength(2);
      expect(st.notices.map((x) => x.kind)).toEqual(["booking.created", "booking.created"]);
    } finally { setBookingRuntimeFactory(null); }
  });
});
