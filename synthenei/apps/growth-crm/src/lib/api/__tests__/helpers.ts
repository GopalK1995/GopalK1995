// Test doubles for the API layer: a chainable PostgREST stand-in, an in-memory key store, idempotency store and logger.
import { vi } from "vitest";
import type { Db } from "../../db/client";
import type { ApiKeyRow, KeyStore } from "../auth";
import { generateKey, type KeyEnv } from "../keys";
import type { IdemBegin, IdempotencyStore } from "../idempotency";
import type { LogEntry, RequestLogger } from "../request-log";

export const WS = "20000000-0000-4000-8000-000000000001";
export const OTHER_WS = "20000000-0000-4000-8000-000000000009";
export const TENANT = "10000000-0000-4000-8000-000000000001";
export const BOT = "30000000-0000-4000-8000-000000000001";

type Result = { data: unknown; error: { code?: string; message?: string } | null };
/** Chain that records calls and resolves to `result` when awaited or when maybeSingle/single is called. */
export function chain(result: Result) {
  const calls: [string, unknown[]][] = [];
  const q: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "delete", "eq", "neq", "gt", "gte", "lt", "lte", "in", "ilike", "is", "or", "order", "limit"]) {
    q[m] = (...a: unknown[]) => { calls.push([m, a]); return q; };
  }
  q.maybeSingle = () => { calls.push(["maybeSingle", []]); return Promise.resolve(result); };
  q.single = () => { calls.push(["single", []]); return Promise.resolve(result); };
  q.then = (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
  return { q, calls };
}

/** Db whose from(table) answers from `tables[table]` (default: empty result). */
export function fakeDb(tables: Record<string, Result> = {}) {
  const log: { table: string; calls: [string, unknown[]][] }[] = [];
  const db = {
    from: (table: string) => {
      const { q, calls } = chain(tables[table] ?? { data: null, error: null });
      log.push({ table, calls });
      return q;
    },
    schema: () => ({ rpc: vi.fn() }),
    rpc: vi.fn(),
  } as unknown as Db;
  return { db, log };
}

export function grantsFor(perms: Record<string, string>, roleKey = "sales_rep") {
  return {
    role: { id: "r1", key: roleKey, base: roleKey },
    perms: Object.fromEntries(Object.entries(perms).map(([k, scope]) => [k, { scope }])),
    team_user_ids: [BOT], attrs: {}, tenant: { uuid: TENANT, slug: "t", status: "active" }, policy: {},
  };
}

export function keyRow(over: Partial<ApiKeyRow> = {}, env: KeyEnv = "live") {
  const g = generateKey(env);
  const row: ApiKeyRow = {
    id: "40000000-0000-4000-8000-000000000001", tenantId: TENANT, workspaceId: WS, name: "Zapier", prefix: g.prefix, keyHash: g.hash, env,
    scopes: ["leads:read", "leads:write"], roleId: "r1", botUserId: BOT, createdBy: "u1", createdAt: "2026-10-01T00:00:00Z", lastUsedAt: null, expiresAt: null, revokedAt: null, ...over,
  };
  return { row, secret: g.key };
}

export function memoryKeyStore(row: ApiKeyRow | null): KeyStore & { touched: string[] } {
  const touched: string[] = [];
  return { touched, findByPrefix: async (p) => (row && row.prefix === p ? row : null), touch: async (id) => { touched.push(id); } };
}

export function memoryIdem(): IdempotencyStore & { rows: Map<string, { hash: string; status: number | null; body: unknown }> } {
  const rows = new Map<string, { hash: string; status: number | null; body: unknown }>();
  return {
    rows,
    async begin(keyId, _t, k, hash): Promise<IdemBegin> {
      const id = `${keyId}:${k}`, r = rows.get(id);
      if (!r) { rows.set(id, { hash, status: null, body: null }); return { state: "new" }; }
      if (r.hash !== hash) return { state: "mismatch" };
      return r.status == null ? { state: "inflight" } : { state: "replay", status: r.status, body: r.body };
    },
    async finish(keyId, k, status, body) { const r = rows.get(`${keyId}:${k}`); if (r) { r.status = status; r.body = body; } },
    async abort(keyId, k) { rows.delete(`${keyId}:${k}`); },
  };
}

export function memoryLogger(): RequestLogger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  return { entries, log: async (e) => { entries.push(e); } };
}

export const okRate = async () => ({ ok: true, remaining: 119, retryAfterSec: 60, limit: 120 });
