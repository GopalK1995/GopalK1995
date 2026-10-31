import { beforeEach, describe, expect, it } from "vitest";
import { memoryStore, rateLimit } from "@/lib/security/rate-limit";
import { hmac } from "../util";
import { MAX_BODY_BYTES, receiveGet, receivePost, type InboundConnection, type InboxStore, type NewInbox, type ReceiveDeps, type ReceiveReq } from "../receive";

const CONN = "5f0c1d52-8a7e-4b1c-9d3e-0a1b2c3d4e5f";
const NOW = 1_700_000_000_000;
const SECRET = "wh-secret-VALUE-123";
const BODY = '{"entry":[{"id":"1","note":"customer-private-text"}]}';

class Inbox implements InboxStore {
  rows: (NewInbox & { id: number })[] = [];
  conns = new Map<string, InboundConnection>();
  async getConnection(id: string) { return this.conns.get(id) ?? null; }
  async insertInbox(n: NewInbox) {
    if (this.rows.some((r) => r.connectorId === n.connectorId && r.providerEventId === n.providerEventId)) return { id: null, duplicate: true };
    const id = this.rows.length + 1; this.rows.push({ ...n, id }); return { id, duplicate: false };
  }
  async deleteInbox(id: number) { this.rows = this.rows.filter((r) => r.id !== id); }
}

let store: Inbox, logs: string[], queued: [string, number, string][], enqueueFails: boolean, enabled: boolean;
function deps(over: Partial<ReceiveDeps> = {}): ReceiveDeps {
  const rl = memoryStore();
  const line = (m: string, f?: Record<string, unknown>) => logs.push(`${m} ${JSON.stringify(f ?? {})}`);
  return {
    store, enabled, now: () => NOW, usable: () => true, metaVerifyToken: "platform-token",
    getSecret: async (id) => (id === "sec-1" ? JSON.stringify({ app_secret: SECRET, verify_token: "own-token" }) : null),
    rate: (scope, id, cfg) => Promise.resolve(rateLimit(scope, id, cfg, { store: rl, now: NOW })),
    enqueue: async (c, id, t) => { if (enqueueFails) throw new Error("pgmq down"); queued.push([c, id, t]); },
    log: { warn: line, error: line },
    ...over,
  };
}
function req(over: Partial<Omit<ReceiveReq, "headers">> & { headers?: Record<string, string>; body?: string; qs?: string } = {}): ReceiveReq {
  const body = over.body ?? BODY;
  const url = `https://app.test/api/hooks/${over.connector ?? "whatsapp"}/${over.connection ?? CONN}${over.qs ?? ""}`;
  return {
    method: "POST", connector: "whatsapp", connection: CONN, url, query: new URL(url).searchParams, contentLength: null, ip: "1.2.3.4",
    readBody: async () => body, ...over, headers: new Headers(over.headers ?? {}),
  };
}
const metaSig = (b = BODY, s = SECRET) => ({ "x-hub-signature-256": "sha256=" + hmac(s, b, "hex") });

beforeEach(() => {
  store = new Inbox(); logs = []; queued = []; enqueueFails = false; enabled = true;
  store.conns.set(CONN, { id: CONN, tenantId: "t-1", workspaceId: "w-1", connectorId: "whatsapp", status: "connected", webhookSecretId: "sec-1", credentialSecretId: null });
});

describe("POST happy path", () => {
  it("verifies on the raw body, stores, enqueues, answers 200 without processing", async () => {
    const r = await receivePost(deps(), req({ headers: metaSig() }));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ signatureOk: true, body: BODY, tenantId: "t-1", workspaceId: "w-1", connectorId: "whatsapp" });
    expect(store.rows[0].headers["x-hub-signature-256"]).toBeUndefined();
    expect(queued).toEqual([["whatsapp", 1, "t-1"]]);
  });
  it("is idempotent: the same delivery twice stores and enqueues once", async () => {
    await receivePost(deps(), req({ headers: metaSig() }));
    const r = await receivePost(deps(), req({ headers: metaSig() }));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, duplicate: true });
    expect(store.rows).toHaveLength(1);
    expect(queued).toHaveLength(1);
  });
  it("dedupes on the vendor event id (razorpay) even when the body differs", async () => {
    store.conns.set(CONN, { ...store.conns.get(CONN)!, connectorId: "razorpay" });
    const one = (b: string) => req({ connector: "razorpay", body: b, headers: { "x-razorpay-signature": hmac(SECRET, b, "hex"), "x-razorpay-event-id": "evt_9" } });
    const d = { ...deps(), getSecret: async () => SECRET };
    await receivePost(d, one('{"a":1}'));
    const r = await receivePost(d, one('{"a":2}'));
    expect(r.json).toEqual({ ok: true, duplicate: true });
    expect(queued).toHaveLength(1);
  });
  it("enqueue failure returns 503 and removes the row so the vendor retry is not a duplicate", async () => {
    enqueueFails = true;
    const r = await receivePost(deps(), req({ headers: metaSig() }));
    expect(r.status).toBe(503);
    expect(store.rows).toHaveLength(0);
    enqueueFails = false;
    expect((await receivePost(deps(), req({ headers: metaSig() }))).status).toBe(200);
    expect(queued).toHaveLength(1);
  });
});

describe("rejections leak nothing", () => {
  it("tampered body, wrong secret, missing signature: 401 with the same generic body; stored without body", async () => {
    for (const r of [
      await receivePost(deps(), req({ headers: metaSig(), body: BODY + " " })),
      await receivePost(deps(), req({ headers: metaSig(BODY, "wrong") })),
      await receivePost(deps(), req({})),
    ]) { expect(r.status).toBe(401); expect(r.json).toEqual({ ok: false }); expect(r.text).toBeUndefined(); }
    expect(store.rows.every((x) => !x.signatureOk && x.body === null)).toBe(true);
    expect(queued).toHaveLength(0);
  });
  it("unknown, malformed, wrong-connector, disabled and unsupported connections: 404 with the same body", async () => {
    const same = { status: 404, json: { ok: false } };
    const cases = [
      req({ connection: "11111111-1111-4111-8111-111111111111", headers: metaSig() }),
      req({ connection: "not-a-uuid", headers: metaSig() }),
      req({ connector: "razorpay", headers: metaSig() }),
      req({ connector: "csv", headers: metaSig() }),
    ];
    for (const c of cases) expect(await receivePost(deps(), c)).toMatchObject(same);
    store.conns.set(CONN, { ...store.conns.get(CONN)!, status: "disconnected" });
    expect(await receivePost(deps(), req({ headers: metaSig() }))).toMatchObject(same);
    expect(store.rows).toHaveLength(0);
  });
  it("demo / unconfigured mode and unusable connectors are 404", async () => {
    enabled = false;
    expect((await receivePost(deps(), req({ headers: metaSig() }))).status).toBe(404);
    enabled = true;
    expect((await receivePost(deps({ usable: () => false }), req({ headers: metaSig() }))).status).toBe(404);
  });
  it("oversize: 413 by header and by actual body", async () => {
    expect((await receivePost(deps(), req({ contentLength: MAX_BODY_BYTES + 1, headers: metaSig() }))).status).toBe(413);
    expect((await receivePost(deps(), req({ body: "x".repeat(MAX_BODY_BYTES + 1) }))).status).toBe(413);
    expect(store.rows).toHaveLength(0);
  });
  it("per-token rate limit returns 429 with Retry-After", async () => {
    const d = deps();
    let last = await receivePost(d, req({ headers: metaSig() }));
    for (let i = 0; i < 305; i++) last = await receivePost(d, req({ headers: metaSig(), body: BODY + i }));
    expect(last.status).toBe(429);
    expect(last.headers?.["Retry-After"]).toBeDefined();
  });
  it("stores at most 30 failed-signature rows per minute per connection", async () => {
    const d = deps();
    for (let i = 0; i < 60; i++) await receivePost(d, req({}));
    expect(store.rows.length).toBe(30);
  });
});

describe("no secret or body in logs", () => {
  it("signature failures, handshake failures and enqueue errors log neither body nor secret", async () => {
    await receivePost(deps(), req({ headers: metaSig(BODY, "wrong") }));
    enqueueFails = true;
    await receivePost(deps(), req({ headers: metaSig() }));
    await receiveGet(deps(), req({ method: "GET", qs: "?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=abc" }));
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join("\n");
    for (const forbidden of [SECRET, "customer-private-text", "own-token", "platform-token", "guess", metaSig()["x-hub-signature-256"]]) expect(all).not.toContain(forbidden);
  });
});

describe("handshakes", () => {
  const q = (t: string) => `?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=CH-123`;
  it("Meta hub.challenge echoes the challenge as text for the connection token and the platform token", async () => {
    for (const t of ["own-token", "platform-token"]) {
      const r = await receiveGet(deps(), req({ method: "GET", qs: q(t) }));
      expect(r).toMatchObject({ status: 200, text: "CH-123" });
    }
  });
  it("wrong token is 403 with no body; non-Meta connectors and unknown connections are 404", async () => {
    expect(await receiveGet(deps(), req({ method: "GET", qs: q("nope") }))).toMatchObject({ status: 403 });
    expect((await receiveGet(deps(), req({ method: "GET", connector: "razorpay", qs: q("own-token") }))).status).toBe(404);
    expect((await receiveGet(deps(), req({ method: "GET", connection: "11111111-1111-4111-8111-111111111111", qs: q("own-token") }))).status).toBe(404);
  });
  it("Slack url_verification is answered after the signature check and not stored", async () => {
    store.conns.set(CONN, { ...store.conns.get(CONN)!, connectorId: "slack" });
    const body = JSON.stringify({ type: "url_verification", challenge: "slack-ch" });
    const ts = String(Math.floor(NOW / 1000));
    const h = { "x-slack-request-timestamp": ts, "x-slack-signature": "v0=" + hmac(SECRET, `v0:${ts}:${body}`, "hex") };
    const d = { ...deps(), getSecret: async () => SECRET };
    expect(await receivePost(d, req({ connector: "slack", body, headers: h }))).toMatchObject({ status: 200, json: { challenge: "slack-ch" } });
    expect(store.rows).toHaveLength(0);
    // expired timestamp is a replay: 401
    const old = String(Math.floor(NOW / 1000) - 3600);
    const hh = { "x-slack-request-timestamp": old, "x-slack-signature": "v0=" + hmac(SECRET, `v0:${old}:${body}`, "hex") };
    expect((await receivePost(d, req({ connector: "slack", body, headers: hh }))).status).toBe(401);
  });
});

describe("pseudo headers cannot be spoofed", () => {
  it("a client-sent x-hook-key does not satisfy Mailchimp; the k query value does", async () => {
    store.conns.set(CONN, { ...store.conns.get(CONN)!, connectorId: "mailchimp" });
    const d = { ...deps(), getSecret: async () => SECRET };
    expect((await receivePost(d, req({ connector: "mailchimp", headers: { "x-hook-key": SECRET } }))).status).toBe(401);
    expect((await receivePost(d, req({ connector: "mailchimp", qs: `?k=${SECRET}` }))).status).toBe(200);
  });
});
