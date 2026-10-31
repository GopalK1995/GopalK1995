import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "../../db/client";
import { createApiKey, revokeApiKey, rotateApiKey } from "../key-admin";
import { hashKey, parseKey } from "../keys";
import { KEY_COLUMNS, PUBLIC_KEY_COLUMNS } from "../auth";
import { buildOpenApi } from "../openapi";
import { dbBackedStore } from "../rate";
import { memoryStore } from "../../security/rate-limit";
import { safePath } from "../request-log";
import { serviceIdempotencyStore, IDEMPOTENCY_TTL_MS } from "../idempotency";
import { TENANT, WS } from "./helpers";

type Call = { table: string; op: string; arg?: unknown };
/** Service client double that records writes and answers selects from a table map. */
function svc(tables: Record<string, unknown>, opts: { failOn?: string } = {}) {
  const calls: Call[] = [];
  const deleted: string[] = [];
  const from = (table: string) => {
    let op = "select", arg: unknown;
    const q: Record<string, unknown> = {};
    const done = () => (opts.failOn === table ? { data: null, error: { code: "XX000", message: "fail" } } : { data: op === "insert" || op === "update" ? (tables[table + ":returned"] ?? tables[table] ?? null) : (tables[table] ?? null), error: null });
    for (const m of ["eq", "is", "in", "order", "limit"]) q[m] = () => q;
    q.select = (c?: string) => { if (op === "select") arg = c; return q; };
    q.insert = (v: unknown) => { op = "insert"; arg = v; return q; };
    q.update = (v: unknown) => { op = "update"; arg = v; return q; };
    q.maybeSingle = () => { calls.push({ table, op, arg }); return Promise.resolve(done()); };
    q.single = () => { calls.push({ table, op, arg }); return Promise.resolve(done()); };
    q.then = (r: (x: unknown) => unknown) => { calls.push({ table, op, arg }); return Promise.resolve(done()).then(r); };
    return q;
  };
  const auth = { admin: { createUser: vi.fn(async () => ({ data: { user: { id: "bot-1" } }, error: null })), deleteUser: vi.fn(async (id: string) => { deleted.push(id); }) } };
  return { db: { from, auth } as unknown as Db, calls, auth, deleted };
}

const input = { tenantId: TENANT, workspaceId: WS, createdBy: "u1", name: "Zapier", env: "live" as const, role: "viewer", scopes: ["leads:read"], expiresAt: null };
const publicRow = { id: "k1", tenant_id: TENANT, workspace_id: WS, name: "Zapier", prefix: "ABCDEFGH", env: "live", scopes: ["leads:read"], role_id: "r1", bot_user_id: "bot-1", created_by: "u1", created_at: "2026-10-01T00:00:00Z", last_used_at: null, expires_at: null, revoked_at: null };

describe("key lifecycle", () => {
  it("create: returns the secret once, stores only prefix and hash, provisions a bot user without a password", async () => {
    const s = svc({ roles: { id: "r1" }, api_keys: [], "api_keys:returned": publicRow });
    // api_keys is read twice (count, then insert): the table answer for select is an empty list
    const out = await createApiKey(input, s.db);
    const parsed = parseKey(out.secret)!;
    expect(parsed.env).toBe("live");
    const ins = s.calls.find((c) => c.table === "api_keys" && c.op === "insert")!.arg as Record<string, unknown>;
    expect(ins.key_hash).toBe(hashKey(out.secret));
    expect(ins.prefix).toBe(parsed.prefix);
    expect(JSON.stringify(ins)).not.toContain(parsed.secret);
    expect(ins).toMatchObject({ scopes: ["leads:read"], created_by: "u1", bot_user_id: "bot-1", workspace_id: WS });
    expect(s.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: false }));
    expect(JSON.stringify(s.auth.admin.createUser.mock.calls[0])).not.toContain("password");
    expect(JSON.stringify(out.key)).not.toContain("key_hash");
    expect(out.key).not.toHaveProperty("keyHash");
    expect(s.calls.find((c) => c.table === "memberships" && c.op === "insert")!.arg).toMatchObject({ user_id: "bot-1", role: "viewer", workspace_id: WS, is_active: true });
  });
  it("create: removes the bot user again when a later step fails", async () => {
    const s = svc({ roles: { id: "r1" }, api_keys: [] }, { failOn: "memberships" });
    await expect(createApiKey(input, s.db)).rejects.toBeTruthy();
    expect(s.deleted).toEqual(["bot-1"]);
  });
  it("create: refuses an unknown system role and enforces the active-key cap", async () => {
    const s = svc({ roles: null, api_keys: [] });
    await expect(createApiKey(input, s.db)).rejects.toMatchObject({ code: "invalid" });
    expect(s.deleted).toEqual(["bot-1"]);
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `k${i}`, expires_at: null }));
    await expect(createApiKey(input, svc({ api_keys: many }).db)).rejects.toMatchObject({ detail: "key limit reached" });
  });
  it("rotate: replaces prefix and hash so the old secret stops working", async () => {
    const s = svc({ api_keys: publicRow, "api_keys:returned": { ...publicRow, prefix: "NEWPREFX" } });
    const out = await rotateApiKey(WS, "k1", s.db);
    const up = s.calls.find((c) => c.op === "update")!.arg as Record<string, unknown>;
    expect(up.key_hash).toBe(hashKey(out.secret));
    expect(up.key_hash).not.toBe(hashKey("sk_live_ABCDEFGH_" + "x".repeat(32)));
    expect(up.last_used_at).toBeNull();
    await expect(rotateApiKey(WS, "k1", svc({ api_keys: { ...publicRow, revoked_at: "2026-10-02T00:00:00Z" } }).db)).rejects.toMatchObject({ code: "invalid" });
    await expect(rotateApiKey(WS, "k1", svc({ api_keys: null }).db)).rejects.toMatchObject({ code: "not_found" });
  });
  it("revoke: stamps revoked_at and deactivates the bot membership; idempotent", async () => {
    const s = svc({ api_keys: { id: "k1", bot_user_id: "bot-1", revoked_at: null } });
    await revokeApiKey(WS, "k1", s.db, new Date("2026-10-05T00:00:00Z"));
    expect(s.calls.find((c) => c.table === "api_keys" && c.op === "update")!.arg).toEqual({ revoked_at: "2026-10-05T00:00:00.000Z" });
    expect(s.calls.find((c) => c.table === "memberships" && c.op === "update")!.arg).toEqual({ is_active: false });
    const again = svc({ api_keys: { id: "k1", bot_user_id: "bot-1", revoked_at: "2026-10-01T00:00:00Z" } });
    await revokeApiKey(WS, "k1", again.db);
    expect(again.calls.some((c) => c.op === "update")).toBe(false);
  });
  it("column lists: key_hash only where the service role needs it", () => {
    expect(KEY_COLUMNS).toContain("key_hash");
    expect(PUBLIC_KEY_COLUMNS).not.toContain("key_hash");
    expect(PUBLIC_KEY_COLUMNS).not.toContain("*");
  });
});

describe("openapi document", () => {
  const doc = buildOpenApi("https://app.example.com/") as { openapi: string; servers: { url: string }[]; paths: Record<string, Record<string, { responses: Record<string, unknown>; security: unknown[] }>>; components: { securitySchemes: object } };
  it("is OpenAPI 3.1 with the contract routes", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.servers[0].url).toBe("https://app.example.com/api/v1");
    for (const p of ["/leads", "/leads/{id}", "/contacts", "/accounts", "/deals", "/deals/{id}/move", "/tasks", "/activities", "/campaigns", "/records/{object}", "/records/{object}/{id}", "/pipelines", "/fields", "/webhooks", "/webhooks/{id}", "/me"]) expect(doc.paths[p], p).toBeTruthy();
    expect(Object.keys(doc.paths["/leads"])).toEqual(expect.arrayContaining(["get", "post"]));
    expect(Object.keys(doc.paths["/leads/{id}"])).toEqual(expect.arrayContaining(["get", "patch", "delete"]));
    expect(doc.components.securitySchemes).toHaveProperty("bearerAuth");
  });
  it("documents the error codes and is generated from the zod schemas", () => {
    expect(Object.keys(doc.paths["/leads"].post.responses)).toEqual(expect.arrayContaining(["201", "401", "403", "404", "409", "422", "429"]));
    const body = JSON.stringify(doc.paths["/leads"].post);
    expect(body).toContain("full_name");
    expect(JSON.stringify(doc)).not.toMatch(/sk_(live|test)_[0-9A-Za-z]{8}_[0-9A-Za-z]{32}/);
  });
});

describe("rate limiting store and logging helpers", () => {
  it("db-backed store: a shared-counter denial wins over the local allowance; db errors fall back to local", async () => {
    const mem = memoryStore();
    const denied = dbBackedStore(mem, () => ({ rpc: async () => ({ data: false, error: null }) }));
    expect((await denied.hit("apikey:k", 5, 60_000, 0)).ok).toBe(false);
    const broken = dbBackedStore(memoryStore(), () => ({ rpc: async () => { throw new Error("db down"); } }));
    expect((await broken.hit("apikey:k", 1, 60_000, 0)).ok).toBe(true);
    expect((await broken.hit("apikey:k", 1, 60_000, 1)).ok).toBe(false);
    const allowed = dbBackedStore(memoryStore(), () => ({ rpc: async () => ({ data: true, error: null }) }));
    const r = await allowed.hit("apikey:k", 2, 60_000, 0);
    expect(r).toMatchObject({ ok: true, remaining: 1 });
  });
  it("safePath drops query strings and redacts pasted keys", () => {
    expect(safePath("https://x/api/v1/leads?filter[email]=a@b.com")).toBe("/api/v1/leads");
    expect(safePath("https://x/api/v1/leads/sk_live_ABCDEFGH_" + "z".repeat(32))).toBe("/api/v1/leads/[redacted]");
  });
  it("idempotency TTL is 24 hours", () => {
    expect(IDEMPOTENCY_TTL_MS).toBe(86_400_000);
    expect(typeof serviceIdempotencyStore).toBe("function");
  });
});
