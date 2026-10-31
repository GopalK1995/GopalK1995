// End-to-end behaviour of the route wrapper with mocked clients: auth, scopes, permission matrix, rate limit, idempotency,
// cross-tenant 404, error envelope and request logging.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { item, collection, RESOURCES } from "../crud";
import { me } from "../misc";
import { route, type Deps } from "../handler";
import { OTHER_WS, WS, fakeDb, grantsFor, keyRow, memoryIdem, memoryKeyStore, memoryLogger, okRate, chain } from "./helpers";

const SECRET = "test-jwt-secret-test-jwt-secret-0123";
const rw = { "leads.read": "all", "leads.create": "all", "leads.write": "all", "leads.delete": "all", "contacts.read": "all" };

function setup(over: { scopes?: string[]; perms?: Record<string, string>; db?: ReturnType<typeof fakeDb>; rate?: Deps["rate"]; keyOver?: Parameters<typeof keyRow>[0]; role?: string } = {}) {
  const { row, secret } = keyRow({ scopes: over.scopes ?? ["leads:read", "leads:write"], ...over.keyOver });
  const f = over.db ?? fakeDb();
  const logger = memoryLogger(), idempotency = memoryIdem();
  const deps: Deps = {
    store: memoryKeyStore(row), jwtSecret: SECRET, makeDb: () => f.db, loadGrants: async () => grantsFor(over.perms ?? rw, over.role),
    rate: over.rate ?? okRate, idempotency, logger, configured: () => true,
  };
  const req = (path: string, init: RequestInit & { key?: string | null } = {}) => {
    const headers = new Headers(init.headers);
    if (init.key !== null) headers.set("authorization", `Bearer ${init.key ?? secret}`);
    return new Request(`https://app.test/api/v1${path}`, { ...init, headers });
  };
  return { row, secret, deps, req, logger, idempotency, f };
}
const ctxId = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

describe("authentication", () => {
  it("404 in demo (Supabase not configured), before reading any key", async () => {
    const s = setup();
    const h = collection(RESOURCES.leads, { ...s.deps, configured: () => false }).GET;
    const r = await h(s.req("/leads"));
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toBe("application/problem+json");
  });
  it("401 for a missing, malformed, unknown, wrong-secret, revoked or expired key", async () => {
    const s = setup();
    const GET = collection(RESOURCES.leads, s.deps).GET;
    expect((await GET(s.req("/leads", { key: null }))).status).toBe(401);
    expect((await GET(s.req("/leads", { key: "nope" }))).status).toBe(401);
    expect((await GET(s.req("/leads", { key: s.secret.slice(0, -1) + (s.secret.endsWith("a") ? "b" : "a") }))).status).toBe(401);
    for (const over of [{ revokedAt: "2026-10-02T00:00:00Z" }, { expiresAt: "2020-01-01T00:00:00Z" }]) {
      const t = setup({ keyOver: over });
      const r = await collection(RESOURCES.leads, t.deps).GET(t.req("/leads"));
      expect(r.status).toBe(401);
      expect(r.headers.get("www-authenticate")).toContain("Bearer");
    }
  });
  it("a sandbox key cannot be used with a live prefix swap (env must match the stored row)", async () => {
    const s = setup();
    const swapped = s.secret.replace("sk_live_", "sk_test_");
    expect((await collection(RESOURCES.leads, s.deps).GET(s.req("/leads", { key: swapped }))).status).toBe(401);
  });
  it("401 when the bot has no membership any more (no role in my_grants)", async () => {
    const s = setup();
    s.deps.loadGrants = async () => ({});
    expect((await collection(RESOURCES.leads, s.deps).GET(s.req("/leads"))).status).toBe(401);
  });
  it("never returns the key hash and does not put the secret in any response", async () => {
    const s = setup();
    const r = await me(s.deps)(s.req("/me"));
    const text = JSON.stringify(await json(r));
    expect(r.status).toBe(200);
    expect(text).not.toContain(s.secret);
    expect(text).not.toContain(s.row.keyHash);
    expect(text).toContain("org_id");
  });
});

describe("scopes and the permission matrix", () => {
  it("403 when the scope is missing even though the role could do it", async () => {
    const s = setup({ scopes: ["leads:read"] });
    const r = await collection(RESOURCES.leads, s.deps).POST!(s.req("/leads", { method: "POST", body: JSON.stringify({ full_name: "Asha" }) }));
    expect(r.status).toBe(403);
    expect((await json(r)).code).toBe("forbidden");
  });
  it("403 when the scope is present but the role lacks the permission (key never exceeds its role)", async () => {
    const s = setup({ scopes: ["leads:write"], perms: { "leads.read": "all" }, role: "viewer" });
    const r = await collection(RESOURCES.leads, s.deps).POST!(s.req("/leads", { method: "POST", body: JSON.stringify({ full_name: "Asha" }) }));
    expect(r.status).toBe(403);
    expect(s.f.log.filter((l) => l.table === "leads")).toHaveLength(0); // never reached the data layer
  });
  it("a read key cannot read a resource outside its scopes", async () => {
    const s = setup({ scopes: ["leads:read"] });
    expect((await collection(RESOURCES.contacts, s.deps).GET(s.req("/contacts"))).status).toBe(403);
  });
  it("campaigns have no write route even with every scope", async () => {
    const s = setup({ scopes: ["campaigns:read"] });
    expect(collection(RESOURCES.campaigns, s.deps)).not.toHaveProperty("POST");
    expect(item(RESOURCES.campaigns, s.deps)).not.toHaveProperty("PATCH");
  });
  it("record-level scope: an own-scope key cannot see someone else's lead (404, not 403)", async () => {
    const row = { id: "L1", workspace_id: WS, owner_id: "someone-else", version: 1, full_name: "X" };
    const s = setup({ perms: { ...rw, "leads.read": "own" }, db: fakeDb({ leads: { data: row, error: null } }) });
    const r = await item(RESOURCES.leads, s.deps).GET(s.req("/leads/L1"), ctxId("L1"));
    expect(r.status).toBe(404);
  });
});

describe("cross-tenant access is 404", () => {
  it("a foreign id (RLS and the workspace filter return no row) is 404 for GET, PATCH, DELETE", async () => {
    const s = setup({ db: fakeDb({ leads: { data: null, error: null } }) });
    const h = item(RESOURCES.leads, s.deps);
    const foreign = "50000000-0000-4000-8000-0000000000ff";
    expect((await h.GET(s.req(`/leads/${foreign}`), ctxId(foreign))).status).toBe(404);
    expect((await h.PATCH!(s.req(`/leads/${foreign}`, { method: "PATCH", body: JSON.stringify({ full_name: "Z" }) }), ctxId(foreign))).status).toBe(404);
    expect((await h.DELETE!(s.req(`/leads/${foreign}`, { method: "DELETE" }), ctxId(foreign))).status).toBe(404);
  });
  it("every read is pinned to the key's own workspace", async () => {
    const s = setup({ db: fakeDb({ leads: { data: [], error: null } }) });
    await collection(RESOURCES.leads, s.deps).GET(s.req(`/leads?filter[status]=new&workspace_id=${OTHER_WS}`));
    const eqs = s.f.log.find((l) => l.table === "leads")!.calls.filter(([m]) => m === "eq");
    expect(eqs).toContainEqual(["eq", ["workspace_id", WS]]);
    expect(JSON.stringify(s.f.log)).not.toContain(OTHER_WS);
  });
  it("the wrong-workspace body field is rejected, not honoured", async () => {
    const s = setup();
    const r = await collection(RESOURCES.leads, s.deps).POST!(s.req("/leads", { method: "POST", body: JSON.stringify({ full_name: "A", workspace_id: OTHER_WS }) }));
    expect(r.status).toBe(422);
  });
});

describe("rate limit", () => {
  it("429 with Retry-After and RateLimit headers when exceeded; success carries the headers too", async () => {
    const limited = setup({ rate: async () => ({ ok: false, remaining: 0, retryAfterSec: 17, limit: 120 }) });
    const r = await collection(RESOURCES.leads, limited.deps).GET(limited.req("/leads"));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("17");
    expect(r.headers.get("ratelimit-limit")).toBe("120");
    expect(r.headers.get("ratelimit-remaining")).toBe("0");
    expect((await json(r)).code).toBe("rate_limited");
    const ok = setup({ db: fakeDb({ leads: { data: [], error: null } }) });
    const r2 = await collection(RESOURCES.leads, ok.deps).GET(ok.req("/leads"));
    expect(r2.headers.get("ratelimit-remaining")).toBe("119");
    expect(r2.headers.get("x-request-id")).toBeTruthy();
  });
  it("the limiter is keyed per key id", async () => {
    const seen: string[] = [];
    const s = setup({ rate: async (id) => { seen.push(id); return { ok: true, remaining: 1, retryAfterSec: 1, limit: 120 }; }, db: fakeDb({ leads: { data: [], error: null } }) });
    await collection(RESOURCES.leads, s.deps).GET(s.req("/leads"));
    expect(seen).toEqual([s.row.id]);
  });
});

describe("idempotency", () => {
  const body = JSON.stringify({ full_name: "Asha" });
  const created = { id: "L9", workspace_id: WS, tenant_id: "t1", full_name: "Asha", version: 1 };
  function mk() {
    const calls = { n: 0 };
    const db = fakeDb();
    // each insert-select-single resolves to the created row; count inserts
    (db.db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const { q, calls: c } = chain({ data: t === "leads" ? created : null, error: null });
      if (t === "leads") { const ins = (q as { insert: (...a: unknown[]) => unknown }).insert; (q as { insert: unknown }).insert = (...a: unknown[]) => { calls.n++; return ins(...a); }; }
      db.log.push({ table: t, calls: c });
      return q;
    };
    return { s: setup({ db }), calls };
  }
  it("same key and body replays the first response and writes once", async () => {
    const { s, calls } = mk();
    const POST = collection(RESOURCES.leads, s.deps).POST!;
    const h = { "idempotency-key": "order-0001-abcd", "content-type": "application/json" };
    const r1 = await POST(s.req("/leads", { method: "POST", body, headers: h }));
    const r2 = await POST(s.req("/leads", { method: "POST", body, headers: h }));
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.headers.get("idempotent-replayed")).toBe("true");
    expect(await json(r2)).toEqual(await json(r1));
    expect(calls.n).toBe(1);
  });
  it("same key with a different body is a 409", async () => {
    const { s } = mk();
    const POST = collection(RESOURCES.leads, s.deps).POST!;
    const h = { "idempotency-key": "order-0002-abcd" };
    await POST(s.req("/leads", { method: "POST", body, headers: h }));
    const r = await POST(s.req("/leads", { method: "POST", body: JSON.stringify({ full_name: "Different" }), headers: h }));
    expect(r.status).toBe(409);
    expect((await json(r)).reason).toBe("idempotency_key_reuse");
  });
  it("a request still in flight is a 409 with Retry-After; client errors replay; a malformed key is 422", async () => {
    const { s } = mk();
    const POST = collection(RESOURCES.leads, s.deps).POST!;
    await s.idempotency.begin(s.row.id, s.row.tenantId, "inflight-key-1", "x");
    const clash = await POST(s.req("/leads", { method: "POST", body, headers: { "idempotency-key": "inflight-key-1" } }));
    expect(clash.status).toBe(409);
    const bad1 = await POST(s.req("/leads", { method: "POST", body: "{}", headers: { "idempotency-key": "client-err-1" } }));
    const bad2 = await POST(s.req("/leads", { method: "POST", body: "{}", headers: { "idempotency-key": "client-err-1" } }));
    expect(bad1.status).toBe(422);
    expect(bad2.status).toBe(422);
    expect(bad2.headers.get("idempotent-replayed")).toBe("true");
    expect(bad2.headers.get("content-type")).toBe("application/problem+json");
    expect((await POST(s.req("/leads", { method: "POST", body, headers: { "idempotency-key": "short" } }))).status).toBe(422);
  });
  it("server errors release the key so a retry can succeed", async () => {
    const s = setup();
    let fail = true;
    const h = route({ resource: "leads", action: "create", body: "required", idempotent: true }, async () => {
      if (fail) throw new Error("boom internal db host");
      return { status: 201, body: { data: { ok: true } } };
    }, s.deps);
    const init = { method: "POST", body, headers: { "idempotency-key": "retry-key-0001" } };
    const r1 = await h(s.req("/leads", init));
    expect(r1.status).toBe(500);
    expect(JSON.stringify(await json(r1))).not.toContain("boom");
    fail = false;
    expect((await h(s.req("/leads", init))).status).toBe(201);
  });
});

describe("validation, envelope and logging", () => {
  it("422 with field paths for invalid bodies; 422 for non-JSON; unknown fields rejected", async () => {
    const s = setup();
    const POST = collection(RESOURCES.leads, s.deps).POST!;
    const r = await POST(s.req("/leads", { method: "POST", body: JSON.stringify({ full_name: "", email: "nope" }) }));
    expect(r.status).toBe(422);
    const b = await json(r);
    expect(b).toMatchObject({ code: "invalid", status: 422, title: expect.any(String), type: expect.stringContaining("/invalid") });
    expect((b.errors as { path: string }[]).map((e) => e.path).sort()).toEqual(["email", "full_name"]);
    expect((await POST(s.req("/leads", { method: "POST", body: "{not json" }))).status).toBe(422);
    expect((await POST(s.req("/leads", { method: "POST", body: "[]" }))).status).toBe(422);
  });
  it("logs method, path, status and key id; never bodies, query strings, headers or the key", async () => {
    const s = setup({ db: fakeDb({ leads: { data: [], error: null } }) });
    await collection(RESOURCES.leads, s.deps).GET(s.req("/leads?filter[email]=asha@example.com&limit=5", { headers: { "x-request-id": "req-abcdef12" } }));
    await collection(RESOURCES.leads, s.deps).POST!(s.req("/leads", { method: "POST", body: JSON.stringify({ full_name: "Secret Person", phone: "9999988888" }) }));
    await new Promise((r) => setTimeout(r, 0));
    expect(s.logger.entries.length).toBeGreaterThanOrEqual(2);
    const blob = JSON.stringify(s.logger.entries);
    for (const needle of [s.secret, s.row.keyHash, "asha@example.com", "Secret Person", "9999988888", "filter[", "authorization"]) expect(blob).not.toContain(needle);
    expect(s.logger.entries[0]).toMatchObject({ method: "GET", path: "/api/v1/leads", status: 200, keyId: s.row.id, workspaceId: WS, requestId: "req-abcdef12" });
  });
  it("redacts a key pasted into a path", async () => {
    const s = setup();
    const r = await collection(RESOURCES.leads, s.deps).GET(s.req(`/leads/${s.secret}`));
    void r;
    const h = item(RESOURCES.leads, s.deps).GET;
    await h(s.req(`/leads/${s.secret}`), ctxId(s.secret));
    await new Promise((r2) => setTimeout(r2, 0));
    expect(JSON.stringify(s.logger.entries)).not.toContain(s.secret.slice(-32));
  });
  it("lists use the cursor envelope and cap the page", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `id${i}`, created_at: `2026-10-0${3 - i}T00:00:00Z`, tenant_id: "t1", workspace_id: WS }));
    const s = setup({ db: fakeDb({ leads: { data: rows, error: null } }) });
    const r = await collection(RESOURCES.leads, s.deps).GET(s.req("/leads?limit=2"));
    const b = (await json(r)) as { data: Record<string, unknown>[]; next_cursor: string | null };
    expect(b.data).toHaveLength(2);
    expect(b.next_cursor).toBeTruthy();
    expect(b.data[0]).toHaveProperty("org_id", "t1");
    expect(b.data[0]).not.toHaveProperty("tenant_id");
    expect((await collection(RESOURCES.leads, s.deps).GET(s.req("/leads?limit=500"))).status).toBe(422);
    expect((await collection(RESOURCES.leads, s.deps).GET(s.req("/leads?cursor=%%%"))).status).toBe(422);
  });
  beforeEach(() => undefined);
});
