import { describe, expect, it } from "vitest";
import { consentRowsForSubject } from "../consent-lookup";
import type { Db } from "@/lib/db/client";

/** Minimal chainable builder: records the calls and resolves to `result`. */
function qb(result: { data: unknown; error: unknown }, log: string[], tag: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) b[m] = (...a: unknown[]) => { log.push(`${tag}.${m}(${a.map((x) => JSON.stringify(x)).join(",")})`); return b; };
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return b;
}
const opts = { ascending: true, limit: 50 };

describe("consentRowsForSubject", () => {
  it("uses consent_log_for_subject when the function exists", async () => {
    const log: string[] = [];
    const db = { rpc: (fn: string, args: unknown) => { log.push(`rpc ${fn} ${JSON.stringify(args)}`); return qb({ data: [{ purpose: "whatsapp" }], error: null }, log, "rpc"); }, from: () => { throw new Error("no direct read"); } };
    const r = await consentRowsForSubject(db as unknown as Db, "ws1", "ref1", "purpose", opts);
    expect(r.data).toEqual([{ purpose: "whatsapp" }]);
    expect(log[0]).toBe('rpc consent_log_for_subject {"p_workspace":"ws1","p_ref":"ref1"}');
  });

  it("falls back to the direct table query before the migration is applied (rpc error)", async () => {
    const log: string[] = [];
    const db = { rpc: () => qb({ data: null, error: { code: "PGRST202" } }, log, "rpc"), from: (t: string) => { log.push(`from ${t}`); return qb({ data: [{ purpose: "x" }], error: null }, log, "tbl"); } };
    const r = await consentRowsForSubject(db as unknown as Db, "ws1", "ref1", "purpose", opts);
    expect(r.data).toEqual([{ purpose: "x" }]);
    expect(log).toContain("from consent_log");
    expect(log).toContain('tbl.eq("subject_ref","ref1")');
  });

  it("falls back when the client has no rpc at all", async () => {
    const log: string[] = [];
    const db = { from: () => qb({ data: [], error: null }, log, "tbl") };
    expect((await consentRowsForSubject(db as unknown as Db, "ws1", "ref1", "purpose", opts)).data).toEqual([]);
  });
});
