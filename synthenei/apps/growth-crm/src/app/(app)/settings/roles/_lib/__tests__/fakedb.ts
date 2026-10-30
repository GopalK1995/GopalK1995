// Minimal in-memory stand-in for the PostgREST builder, enough for settings/roles/_lib/store.ts. Records every write.
import type { Db } from "@/lib/db/client";

type Row = Record<string, unknown>;
export interface Write { table: string; op: "insert" | "update" | "delete" | "upsert" | "rpc"; payload?: unknown; match?: Record<string, unknown> }
type Fail = (table: string, op: string, payload: unknown) => { code: string; message: string } | null;

export function fakeDb(seed: Record<string, Row[]>, o: { rpc?: (name: string, args: Record<string, unknown>) => unknown; fail?: Fail } = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const writes: Write[] = [];
  let seq = 1;
  const builder = (table: string) => {
    const st = { op: "select" as "select" | Write["op"], filters: [] as [string, "eq" | "in" | "is", unknown][], payload: undefined as unknown, single: false, maybe: false, limit: 1000, conflict: "" };
    const self: Record<string, unknown> = {};
    const add = (kind: "eq" | "in" | "is") => (c: string, v: unknown) => { st.filters.push([c, kind, v]); return self; };
    Object.assign(self, {
      select: () => self, order: () => self, or: () => self, limit: (n: number) => { st.limit = n; return self; },
      eq: add("eq"), in: add("in"), is: add("is"), neq: () => self, gt: () => self, gte: () => self, lt: () => self, lte: () => self, ilike: () => self,
      single: () => { st.single = true; return self; }, maybeSingle: () => { st.maybe = true; return self; },
      insert: (p: unknown) => { st.op = "insert"; st.payload = p; return self; },
      update: (p: unknown) => { st.op = "update"; st.payload = p; return self; },
      upsert: (p: unknown, opt?: { onConflict?: string }) => { st.op = "upsert"; st.payload = p; st.conflict = opt?.onConflict ?? ""; return self; },
      delete: () => { st.op = "delete"; return self; },
      then: (res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    });
    const match = (r: Row) => st.filters.every(([c, k, v]) => (k === "eq" ? r[c] === v : k === "in" ? (v as unknown[]).includes(r[c]) : r[c] === null || r[c] === undefined));
    const run = () => {
      const rows = (tables[table] ??= []);
      if (st.op !== "select") {
        const f = o.fail?.(table, st.op, st.payload);
        if (f) return { data: null, error: f };
        writes.push({ table, op: st.op, payload: st.payload, match: Object.fromEntries(st.filters.map(([c, , v]) => [c, v])) });
      }
      let data: Row[] = [];
      if (st.op === "select") data = rows.filter(match).slice(0, st.limit);
      else if (st.op === "insert") {
        data = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((p) => ({ id: `new-${seq++}`, updated_at: "2026-10-30T00:00:00Z", ...(p as Row) }));
        rows.push(...data);
      } else if (st.op === "update") { data = rows.filter(match); data.forEach((r) => Object.assign(r, st.payload)); }
      else if (st.op === "delete") { data = rows.filter(match); tables[table] = rows.filter((r) => !data.includes(r)); }
      else if (st.op === "upsert") {
        const cols = st.conflict.split(",").filter(Boolean);
        for (const p of Array.isArray(st.payload) ? st.payload : [st.payload]) {
          const ex = rows.find((r) => cols.every((c) => r[c] === (p as Row)[c]));
          if (ex) Object.assign(ex, p); else rows.push({ ...(p as Row) });
          data.push(p as Row);
        }
      }
      if (st.single || st.maybe) {
        if (!data[0] && st.single) return { data: null, error: { code: "PGRST116", message: "no rows" } };
        return { data: data[0] ?? null, error: null };
      }
      return { data, error: null };
    };
    return self;
  };
  const db = {
    from: builder,
    rpc: async (name: string, args: Record<string, unknown>) => {
      writes.push({ table: `rpc:${name}`, op: "rpc", payload: args });
      return { data: o.rpc?.(name, args) ?? null, error: null };
    },
  } as unknown as Db;
  return { db, tables, writes };
}
