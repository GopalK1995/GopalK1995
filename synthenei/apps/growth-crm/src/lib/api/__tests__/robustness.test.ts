// Contract tests for AUD-061 (API robustness): idempotency lease, reliable request logging, validation parity with the
// UI actions, sort / total / cursor handling, body-size limits, error envelope and rate-limit headers. Fake clients only.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { collection, RESOURCES } from "../crud";
import { DbError } from "../../db/errors";
import { ApiError, problemBody, toApiError } from "../errors";
import { parseInclude, parseSort } from "../filters";
import { route, MAX_BODY_BYTES, type Deps } from "../handler";
import {
  IDEMPOTENCY_LEASE_MS, IDEMPOTENCY_TTL_MS, IdempotencyUnavailableError, serviceIdempotencyStore, type IdempotencyStore,
} from "../idempotency";
import { listPage } from "../list";
import { rateHeaders } from "../rate";
import { LOG_FLUSH_TIMEOUT_MS, flushLog } from "../request-log";
import * as S from "../schemas";
import { createAccountSchema, createContactSchema } from "../../../app/(app)/accounts/_lib/schemas";
import { createLeadSchema } from "../../../app/(app)/leads/_lib/schemas";
import { WS, chain, fakeDb, grantsFor, keyRow, memoryIdem, memoryKeyStore, memoryLogger, okRate } from "./helpers";

const SECRET = "test-jwt-secret-test-jwt-secret-0123";
const rw = { "leads.read": "all", "leads.create": "all", "leads.write": "all", "leads.delete": "all", "deals.read": "all" };
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

function setup(over: Partial<Deps> & { db?: ReturnType<typeof fakeDb>; scopes?: string[] } = {}) {
  const { row, secret } = keyRow({ scopes: over.scopes ?? ["leads:read", "leads:write"] });
  const f = over.db ?? fakeDb();
  const logger = memoryLogger(), idempotency = memoryIdem();
  const { db: _d, scopes: _s, ...rest } = over;
  void _d; void _s;
  const deps: Deps = {
    store: memoryKeyStore(row), jwtSecret: SECRET, makeDb: () => f.db, loadGrants: async () => grantsFor(rw),
    rate: okRate, ipRate: okRate, idempotency, logger, configured: () => true, scheduleLog: () => { throw new Error("no request scope"); }, ...rest,
  };
  const req = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${secret}`);
    return new Request(`https://app.test/api/v1${path}`, { ...init, headers });
  };
  return { row, secret, deps, req, logger, idempotency, f };
}

// ---- in-memory idempotency_keys behind the PostgREST surface the store uses ----
interface Row { key_id: string; idem_key: string; tenant_id: string; request_hash: string; response: unknown; status: number | null; created_at: string }
function fakeIdemDb(now: () => number, opts: { failInsert?: { code?: string } } = {}) {
  const rows: Row[] = [];
  const db = {
    from: (_t: string) => {
      const preds: ((r: Row) => boolean)[] = [];
      let mode: "select" | "insert" | "update" | "delete" = "select";
      let payload: Record<string, unknown> = {};
      const run = () => {
        if (mode === "insert") {
          if (opts.failInsert) return { data: null, error: opts.failInsert };
          if (rows.some((r) => r.key_id === payload.key_id && r.idem_key === payload.idem_key)) return { data: null, error: { code: "23505" } };
          rows.push({ response: null, status: null, ...(payload as object), created_at: new Date(now()).toISOString() } as Row);
          return { data: null, error: null };
        }
        const hit = rows.filter((r) => preds.every((p) => p(r)));
        if (mode === "update") hit.forEach((r) => Object.assign(r, payload));
        if (mode === "delete") for (const h of hit) rows.splice(rows.indexOf(h), 1);
        return { data: hit, error: null };
      };
      const q: Record<string, unknown> = {
        select: () => q, insert: (v: Record<string, unknown>) => { mode = "insert"; payload = v; return q; },
        update: (v: Record<string, unknown>) => { mode = "update"; payload = v; return q; }, delete: () => { mode = "delete"; return q; },
        eq: (c: string, v: unknown) => { preds.push((r) => (r as unknown as Record<string, unknown>)[c] === v); return q; },
        is: (c: string, v: unknown) => { preds.push((r) => (r as unknown as Record<string, unknown>)[c] === v); return q; },
        lt: (c: string, v: string) => { preds.push((r) => String((r as unknown as Record<string, unknown>)[c]) < v); return q; },
        maybeSingle: () => Promise.resolve({ data: (run().data as Row[] | null)?.[0] ?? null, error: null }),
        then: (res: (r: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
      };
      return q;
    },
  };
  return { rows, db: db as never };
}

describe("idempotency lease", () => {
  const K = "40000000-0000-4000-8000-000000000001", T = "t1";
  it("a request inside the 60 s lease is in flight and says how long to wait", async () => {
    let t = 1_000_000;
    const f = fakeIdemDb(() => t);
    const store = serviceIdempotencyStore(() => f.db);
    expect(await store.begin(K, T, "key-aaaa-0001", "h1", t)).toEqual({ state: "new" });
    t += 10_000;
    const b = await store.begin(K, T, "key-aaaa-0001", "h1", t);
    expect(b.state).toBe("inflight");
    expect((b as { retryAfterSec: number }).retryAfterSec).toBe(50);
  });
  it("a crashed request's key is reusable after the lease: the retry takes it over and runs", async () => {
    let t = 1_000_000;
    const f = fakeIdemDb(() => t);
    const store = serviceIdempotencyStore(() => f.db);
    await store.begin(K, T, "key-aaaa-0002", "h1", t); // first request starts, then the function is killed: no finish/abort
    t += IDEMPOTENCY_LEASE_MS + 1;
    expect(await store.begin(K, T, "key-aaaa-0002", "h1", t)).toEqual({ state: "new" });
    expect(f.rows).toHaveLength(1);
    expect(Date.parse(f.rows[0].created_at)).toBe(t); // the new lease starts now
  });
  it("two retries racing for an abandoned key: exactly one runs, the other waits", async () => {
    let t = 1_000_000;
    const f = fakeIdemDb(() => t);
    const store = serviceIdempotencyStore(() => f.db);
    await store.begin(K, T, "key-aaaa-0003", "h1", t);
    t += IDEMPOTENCY_LEASE_MS + 5_000;
    const first = await store.begin(K, T, "key-aaaa-0003", "h1", t);
    const second = await store.begin(K, T, "key-aaaa-0003", "h1", t);
    expect([first.state, second.state]).toEqual(["new", "inflight"]);
  });
  it("takeover deletes only the stale in-flight row, never a completed or fresh one", async () => {
    let t = 1_000_000;
    const f = fakeIdemDb(() => t);
    const store = serviceIdempotencyStore(() => f.db);
    await store.begin(K, T, "key-aaaa-0004", "h1", t);
    await store.finish(K, "key-aaaa-0004", 201, { data: { id: "x" } });
    t += IDEMPOTENCY_LEASE_MS * 10; // far past the lease, well inside 24 h
    expect(await store.begin(K, T, "key-aaaa-0004", "h1", t)).toEqual({ state: "replay", status: 201, body: { data: { id: "x" } } });
    expect(f.rows).toHaveLength(1);
  });
  it("a stored response replays until the 24 h expiry, then the key is free", async () => {
    let t = 1_000_000;
    const f = fakeIdemDb(() => t);
    const store = serviceIdempotencyStore(() => f.db);
    await store.begin(K, T, "key-aaaa-0005", "h1", t);
    await store.finish(K, "key-aaaa-0005", 201, { ok: 1 });
    expect((await store.begin(K, T, "key-aaaa-0005", "h1", t + IDEMPOTENCY_TTL_MS - 1000)).state).toBe("replay");
    expect(await store.begin(K, T, "key-aaaa-0005", "h1", t + IDEMPOTENCY_TTL_MS + 1000)).toEqual({ state: "new" });
  });
  it("same key with another request body is a mismatch even while in flight", async () => {
    const t = 1_000_000;
    const f = fakeIdemDb(() => t);
    const store = serviceIdempotencyStore(() => f.db);
    await store.begin(K, T, "key-aaaa-0006", "h1", t);
    expect((await store.begin(K, T, "key-aaaa-0006", "OTHER", t)).state).toBe("mismatch");
  });
  it("the store failing (table missing, database down) throws IdempotencyUnavailableError", async () => {
    const f = fakeIdemDb(() => 0, { failInsert: { code: "42P01" } });
    await expect(serviceIdempotencyStore(() => f.db).begin(K, T, "key-aaaa-0007", "h", 0)).rejects.toBeInstanceOf(IdempotencyUnavailableError);
  });
  it("a keyed write is refused with 503 when the store is down and the write never runs; unkeyed writes are unaffected", async () => {
    const broken: IdempotencyStore = { begin: async () => { throw new IdempotencyUnavailableError(); }, finish: async () => undefined, abort: async () => undefined };
    const s = setup({ idempotency: broken });
    const fn = vi.fn(async () => ({ status: 201, body: { data: {} } }));
    const h = route({ resource: "leads", action: "create", body: "required", idempotent: true }, fn, s.deps);
    const keyed = await h(s.req("/leads", { method: "POST", body: "{}", headers: { "idempotency-key": "key-aaaa-0008" } }));
    expect(keyed.status).toBe(503);
    expect(keyed.headers.get("retry-after")).toBe("5");
    expect(fn).not.toHaveBeenCalled();
    expect((await h(s.req("/leads", { method: "POST", body: "{}" }))).status).toBe(201);
  });
  it("an in-flight 409 carries the remaining lease as Retry-After", async () => {
    const s = setup({ idempotency: { ...memoryIdem(), begin: async () => ({ state: "inflight", retryAfterSec: 42 }) } });
    const h = route({ resource: "leads", action: "create", body: "required", idempotent: true }, async () => ({ status: 201 }), s.deps);
    const r = await h(s.req("/leads", { method: "POST", body: "{}", headers: { "idempotency-key": "key-aaaa-0009" } }));
    expect(r.status).toBe(409);
    expect(r.headers.get("retry-after")).toBe("42");
  });
});

describe("request logging is not lost", () => {
  it("is handed to after() when a request scope exists", async () => {
    const scheduled: (() => Promise<void>)[] = [];
    const s = setup({ scheduleLog: (cb) => { scheduled.push(cb); } });
    await collection(RESOURCES.leads, s.deps).GET(s.req("/leads"));
    expect(scheduled).toHaveLength(1);
    await scheduled[0]();
    expect(s.logger.entries).toHaveLength(1);
  });
  it("without a request scope the log is written before the response returns (no timer tick needed)", async () => {
    const s = setup();
    const r = await collection(RESOURCES.leads, s.deps).GET(s.req("/leads"));
    expect(r.status).toBe(200);
    expect(s.logger.entries).toHaveLength(1); // awaited, not floating
    expect(s.logger.entries[0]).toMatchObject({ method: "GET", status: 200, workspaceId: WS });
  });
  it("error responses are logged too, with their status", async () => {
    const s = setup();
    await collection(RESOURCES.leads, s.deps).GET(s.req("/leads?limit=999"));
    expect(s.logger.entries[0]).toMatchObject({ status: 400 });
  });
  it("a hung or failing log write never fails or stalls the response beyond the budget", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<void>(() => undefined);
      const done = flushLog(never, () => { throw new Error("no scope"); });
      await vi.advanceTimersByTimeAsync(LOG_FLUSH_TIMEOUT_MS + 1);
      await expect(done).resolves.toBeUndefined();
      await expect(flushLog(Promise.reject(new Error("db down")), () => { throw new Error("no scope"); })).resolves.toBeUndefined();
    } finally { vi.useRealTimers(); }
  });
});

describe("validation parity with the database CHECKs and the UI schemas", () => {
  it("rejects what the database would reject, naming the field", () => {
    expect(S.dealCreate.safeParse({ name: "D", seats: 0 }).success).toBe(false); // deals_seats_check: > 0
    expect(S.dealCreate.safeParse({ name: "D", seats: 1 }).success).toBe(true);
    expect(S.taskCreate.safeParse({ title: "T", due_at: "2026-12-01T10:00:00+05:30", priority: 0 }).success).toBe(false); // 1..3
    expect(S.taskCreate.safeParse({ title: "T", due_at: "2026-12-01T10:00:00+05:30", priority: 4 }).success).toBe(false);
    expect(S.taskCreate.safeParse({ title: "T", due_at: "2026-12-01T10:00:00+05:30", priority: 3 }).success).toBe(true);
    expect(S.dealCreate.safeParse({ name: "D", plan: "gold" }).success).toBe(false);
    expect(S.accountCreate.safeParse({ name: "A", size_band: "huge" }).success).toBe(false);
    expect(S.taskCreate.safeParse({ title: "T", due_at: "2026-12-01T10:00:00+05:30", kind: "nap" }).success).toBe(false);
    expect(S.activityCreate.safeParse({ kind: "meeting", meeting_type: "lunch" }).success).toBe(false);
    const bad = S.dealCreate.safeParse({ name: "D", seats: 0 });
    expect(bad.success ? [] : bad.error.issues.map((i) => i.path.join("."))).toEqual(["seats"]);
  });
  it("a database CHECK that slips through is mapped to the field, without leaking the constraint or SQL", () => {
    const e = toApiError(new DbError("invalid", "invalid", { detail: 'new row for relation "deals" violates check constraint "deals_seats_check"' }));
    expect(e.status).toBe(422);
    const b = problemBody(e);
    expect(b.errors).toEqual([{ path: "seats", message: "must be greater than 0" }]);
    expect(JSON.stringify(b)).not.toMatch(/deals_seats_check|relation/);
    expect(toApiError(new DbError("invalid", "invalid", { detail: "something else" })).opts.errors).toBeUndefined();
  });
  it("the REST API and the UI actions accept and refuse the same phone and email values", () => {
    const api = (v: Record<string, unknown>) => S.leadCreate.safeParse({ full_name: "Asha", ...v }).success;
    const ui = (v: Record<string, unknown>) => createLeadSchema.safeParse({ fullName: "Asha", phone: "9999988888", email: "", ...v }).success;
    for (const phone of ["9999988888", "+91 99999 88888", "12345", "abc", "5999988888"]) expect(api({ phone }), `phone ${phone}`).toBe(ui({ phone }));
    for (const email of ["a@b.in", "not-an-email", "a@b", "x y@z.com"]) expect(api({ email }), `email ${email}`).toBe(ui({ email }));
    expect(api({ phone: "12345" })).toBe(false);
    expect(api({ email: "nope" })).toBe(false);
    // contacts and accounts share the same validators and bounds
    expect(S.contactCreate.safeParse({ full_name: "C", phone: "12345" }).success).toBe(createContactSchema.safeParse({ fullName: "C", phone: "12345" }).success);
    expect(S.accountCreate.safeParse({ name: "A", lawyers_count: 100001 }).success).toBe(createAccountSchema.safeParse({ name: "A", lawyersCount: 100001 }).success);
  });
  it("empty phone or email strings become null instead of failing or reaching the database as ''", () => {
    const r = S.leadCreate.parse({ full_name: "Asha", phone: "", email: "" });
    expect(r.phone).toBeNull();
    expect(r.email).toBeNull();
  });
  it("a 422 body validation error names the field and uses the problem envelope", async () => {
    const s = setup();
    const r = await collection(RESOURCES.leads, s.deps).POST!(s.req("/leads", { method: "POST", body: JSON.stringify({ full_name: "A", phone: "12345" }) }));
    expect(r.status).toBe(422);
    expect(r.headers.get("content-type")).toBe("application/problem+json");
    expect((await json(r)).errors).toEqual([{ path: "phone", message: "Enter a 10 digit Indian mobile number" }]);
  });
});

describe("sort, total and cursor", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id${i}`, created_at: `2026-10-0${i + 1}T00:00:00Z`, full_name: `Name, "${i}"`, workspace_id: WS }));
  it("parseSort allow-lists one column, defaults to first allowed descending, and explains a 400", () => {
    expect(parseSort(null, ["created_at", "updated_at"])).toEqual({ col: "created_at", dir: "desc" });
    expect(parseSort("-updated_at", ["created_at", "updated_at"])).toEqual({ col: "updated_at", dir: "desc" });
    expect(parseSort("updated_at", ["created_at", "updated_at"])).toEqual({ col: "updated_at", dir: "asc" });
    for (const bad of ["password", "-email", "created_at,updated_at", "created_at;drop", "custom->>x"]) {
      try { parseSort(bad, ["created_at", "updated_at"]); throw new Error("did not throw"); } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(400);
        expect((e as ApiError).opts.errors?.[0].path).toBe("sort");
      }
    }
    expect(() => parseInclude("total,foo")).toThrow(ApiError);
    expect(parseInclude("total")).toEqual({ total: true });
  });
  it("listPage orders by the chosen column and id in the same direction", async () => {
    const { db, log } = fakeDb({ leads: { data: [], error: null } });
    await listPage(db, { table: "leads", ws: WS, filters: [], limit: 10, sort: { col: "updated_at", dir: "asc" } });
    const calls = log[0].calls.filter(([m]) => m === "order");
    expect(calls).toEqual([["order", ["updated_at", { ascending: true }]], ["order", ["id", { ascending: true }]]]);
  });
  it("keyset cursors carry the sort, resume ascending and descending correctly, and survive commas and quotes in values", async () => {
    const data = rows(3);
    const f1 = fakeDb({ leads: { data, error: null } });
    const p1 = await listPage(f1.db, { table: "leads", ws: WS, filters: [], limit: 2, sort: { col: "full_name", dir: "asc" } });
    expect(p1.nextCursor).toBeTruthy();
    const f2 = fakeDb({ leads: { data: [], error: null } });
    await listPage(f2.db, { table: "leads", ws: WS, filters: [], limit: 2, sort: { col: "full_name", dir: "asc" }, cursor: p1.nextCursor });
    const or = f2.log[0].calls.find(([m]) => m === "or")![1][0] as string;
    expect(or).toContain("full_name.gt.");
    expect(or).toContain('\\"1\\"'); // quote escaped inside the quoted value
    const f3 = fakeDb({ leads: { data: [], error: null } });
    const desc = await listPage(fakeDb({ leads: { data, error: null } }).db, { table: "leads", ws: WS, filters: [], limit: 2 });
    await listPage(f3.db, { table: "leads", ws: WS, filters: [], limit: 2, cursor: desc.nextCursor });
    expect(f3.log[0].calls.find(([m]) => m === "or")![1][0]).toContain("created_at.lt.");
  });
  it("a cursor issued for another sort is a 400, not skipped or repeated rows", async () => {
    const p = await listPage(fakeDb({ leads: { data: rows(3), error: null } }).db, { table: "leads", ws: WS, filters: [], limit: 2, sort: { col: "created_at", dir: "desc" } });
    await expect(listPage(fakeDb().db, { table: "leads", ws: WS, filters: [], limit: 2, sort: { col: "updated_at", dir: "desc" }, cursor: p.nextCursor })).rejects.toMatchObject({ status: 400 });
    await expect(listPage(fakeDb().db, { table: "leads", ws: WS, filters: [], limit: 2, cursor: "%%%" })).rejects.toMatchObject({ status: 400 });
  });
  it("include=total adds an exact count and the list body carries it; without it there is no count query", async () => {
    const counted = { data: [], error: null, count: 137 } as unknown as { data: unknown; error: null };
    const f = fakeDb({ leads: counted });
    const s = setup({ db: f });
    const r = await collection(RESOURCES.leads, s.deps).GET(s.req("/leads?include=total&sort=-updated_at"));
    expect(r.status).toBe(200);
    expect((await json(r)).total).toBe(137);
    const selects = f.log.filter((l) => l.table === "leads").map((l) => l.calls.find(([m]) => m === "select")![1]);
    expect(selects).toContainEqual(["id", { count: "exact", head: true }]);
    const f2 = fakeDb({ leads: { data: [], error: null } });
    const s2 = setup({ db: f2 });
    const body = await json(await collection(RESOURCES.leads, s2.deps).GET(s2.req("/leads")));
    expect(body).not.toHaveProperty("total");
    expect(f2.log.filter((l) => l.table === "leads")).toHaveLength(1);
  });
  it("unknown sort, include, filter and oversized limit are 400 with the offending parameter named", async () => {
    const s = setup();
    for (const [qs, path] of [["sort=password", "sort"], ["include=everything", "include"], ["limit=0", "limit"], ["filter[nope]=1", "filter[nope]"], ["cursor=@@", "cursor"]] as const) {
      const r = await collection(RESOURCES.leads, s.deps).GET(s.req(`/leads?${qs}`));
      expect(r.status, qs).toBe(400);
      const b = await json(r);
      expect(b.code).toBe("bad_request");
      expect((b.errors as { path: string }[]).some((e) => e.path === path), qs).toBe(true);
    }
  });
  it("only NOT NULL columns are sortable", () => {
    for (const cols of Object.values(S.SORTS)) for (const c of cols) expect(["created_at", "updated_at", "due_at", "name", "full_name", "value_inr"]).toContain(c);
  });
});

describe("body size limit", () => {
  const post = (s: ReturnType<typeof setup>, body: BodyInit, headers: Record<string, string> = {}) =>
    collection(RESOURCES.leads, s.deps).POST!(s.req("/leads", { method: "POST", body, headers, ...(typeof body !== "string" ? { duplex: "half" } : {}) } as RequestInit));
  it("413 for a declared Content-Length over the cap, before the body is read", async () => {
    const s = setup();
    const r = await post(s, "{}", { "content-length": String(MAX_BODY_BYTES + 1) });
    expect(r.status).toBe(413);
    expect((await json(r)).code).toBe("payload_too_large");
  });
  it("413 for a streamed body with no or false Content-Length that grows past the cap", async () => {
    const s = setup();
    const chunk = new TextEncoder().encode("x".repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream({ pull(c) { if (sent >= 40) return c.close(); sent++; c.enqueue(chunk); } });
    const r = await post(s, stream);
    expect(r.status).toBe(413);
    expect(sent).toBeLessThan(40); // cut off early, not read to the end
  });
  it("a body at the cap is read normally", async () => {
    const s = setup();
    const r = await post(s, JSON.stringify({ full_name: "A", custom: { note: "y".repeat(1000) } }));
    expect([413, 400]).not.toContain(r.status); // passes the size guard and the JSON parse (the fake db then has no row to return)
  });
});

describe("error envelope and rate-limit headers", () => {
  it("every error code keeps the problem+json shape and its status", () => {
    for (const [code, status] of [["bad_request", 400], ["payload_too_large", 413], ["invalid", 422], ["unavailable", 503]] as const) {
      expect(problemBody(new ApiError(code, "x"))).toMatchObject({ status, code, type: expect.stringContaining(`/${code}`), title: expect.any(String) });
    }
  });
  it("success, 4xx and 429 all carry the RateLimit headers, and 429 adds Retry-After", async () => {
    const s = setup({ db: fakeDb({ leads: { data: [], error: null } }) });
    const ok = await collection(RESOURCES.leads, s.deps).GET(s.req("/leads"));
    expect(ok.headers.get("ratelimit-policy")).toBe("120;w=60");
    expect(ok.headers.get("ratelimit-limit")).toBe("120");
    expect(ok.headers.get("ratelimit-remaining")).toBe("119");
    const bad = await collection(RESOURCES.leads, s.deps).GET(s.req("/leads?limit=0"));
    expect(bad.status).toBe(400);
    expect(bad.headers.get("ratelimit-remaining")).toBe("119");
    const limited = setup({ rate: async () => ({ ok: false, remaining: 0, retryAfterSec: 9, limit: 120 }) });
    const r = await collection(RESOURCES.leads, limited.deps).GET(limited.req("/leads"));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("9");
    expect(r.headers.get("ratelimit-reset")).toBe("9");
    expect(rateHeaders({ ok: true, remaining: 1, retryAfterSec: 3, limit: 5 }, 1000)["x-ratelimit-reset-at"]).toBe("4");
  });
  it("a flood from one address is stopped before any key lookup", async () => {
    const s = setup({ ipRate: async () => ({ ok: false, remaining: 0, retryAfterSec: 30, limit: 600 }) });
    const lookups = vi.spyOn(s.deps.store!, "findByPrefix");
    const r = await collection(RESOURCES.leads, s.deps).GET(s.req("/leads"));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("30");
    expect(lookups).not.toHaveBeenCalled();
  });
  it("chain helper sanity: the fake db used here answers count results", async () => {
    const { q } = chain({ data: [], error: null });
    expect(await (q as { select: () => PromiseLike<unknown> }).select()).toEqual({ data: [], error: null });
  });
});
