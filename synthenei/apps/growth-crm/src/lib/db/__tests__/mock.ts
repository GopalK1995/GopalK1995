import type { Db } from "../client";
import type { QResult } from "../query";

export interface Call { table: string; ops: [string, unknown[]][] }

/** Chainable, thenable stand-in for the PostgREST builder. `results` is consumed one per awaited query. */
export function mockDb(results: QResult[]): { db: Db; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const db = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const p: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "eq", "neq", "gt", "gte", "lt", "lte", "in", "ilike", "is", "or", "order", "limit", "single", "maybeSingle"]) {
        p[m] = (...args: unknown[]) => { call.ops.push([m, args]); return p; };
      }
      p.then = (res: (v: QResult) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(results[i++] ?? { data: null, error: null }).then(res, rej);
      return p;
    },
  } as unknown as Db;
  return { db, calls };
}

export const ok = (data: unknown): QResult => ({ data, error: null });
export const err = (code: string, message = "boom"): QResult => ({ data: null, error: { code, message } });
export const has = (c: Call, op: string, ...args: unknown[]) => c.ops.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args));
