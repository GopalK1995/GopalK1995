// Minimal chainable stand-in for the Supabase client: records every operation, answers selects from a per-table fixture.
import type { Db } from "@/lib/db/client";

export interface Op { table: string; op: "select" | "insert" | "update" | "delete" | "rpc"; payload?: unknown; filters: [string, unknown][] }
type Row = Record<string, unknown>;
export interface FakeOpts { tables?: Record<string, Row[] | { error: { code: string } }>; rpc?: Record<string, { error: { code?: string; message?: string } | null }>; failOn?: (op: Op) => { code: string } | null }

export function fakeDb(o: FakeOpts = {}): { db: Db; ops: Op[] } {
  const ops: Op[] = [];
  const result = (op: Op) => {
    const forced = o.failOn?.(op);
    if (forced) return { data: null, error: forced };
    const t = o.tables?.[op.table];
    if (t && !Array.isArray(t)) return { data: null, error: t.error };
    if (op.op === "select") return { data: t ?? [], error: null };
    if (op.op === "insert" || op.op === "update" || op.op === "delete") return { data: Array.isArray(t) && t.length ? t : [{ id: "x" }], error: null };
    return { data: null, error: null };
  };
  const chain = (table: string, op: Op["op"], payload?: unknown) => {
    const rec: Op = { table, op, payload, filters: [] };
    ops.push(rec);
    const c: Record<string, unknown> = {};
    for (const m of ["eq", "neq", "gt", "gte", "lt", "lte", "in", "ilike", "is", "or"]) c[m] = (col: string, v: unknown) => { rec.filters.push([`${m}:${col}`, v]); return c; };
    for (const m of ["select", "order", "limit", "single", "maybeSingle"]) c[m] = () => { if (m === "maybeSingle" || m === "single") rec.payload = rec.payload ?? "one"; return c; };
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      const r = result(rec);
      const one = rec.payload === "one" && op === "select";
      return Promise.resolve(one ? { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error } : r).then(res, rej);
    };
    return c;
  };
  const db = {
    from: (table: string) => ({
      select: () => chain(table, "select"), insert: (p: unknown) => chain(table, "insert", p), update: (p: unknown) => chain(table, "update", p), delete: () => chain(table, "delete"),
    }),
    rpc: (fn: string, args: unknown) => {
      const rec: Op = { table: `rpc:${fn}`, op: "rpc", payload: args, filters: [] };
      ops.push(rec);
      return Promise.resolve(o.rpc?.[fn] ?? { error: null });
    },
  };
  return { db: db as unknown as Db, ops };
}
