import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobContext } from "@/lib/jobs/registry";
import { memLogger } from "@/lib/jobs/__tests__/fakes";

vi.mock("server-only", () => ({}));
const { getHandler } = await import("@/lib/jobs/registry");
const { PURGE_KIND, RETENTION_KIND, purgeHandler, retentionHandler } = await import("../job");

const ctx = (db: unknown): JobContext & { log: ReturnType<typeof memLogger> } => ({ runId: 1, attempt: 1, tenantId: null, log: memLogger(), deadline: Date.now() + 60_000, db: db as SupabaseClient });

describe("privacy jobs", () => {
  it("both handlers register on the maintenance queue", () => {
    expect(getHandler("maintenance", RETENTION_KIND)).toBe(retentionHandler);
    expect(getHandler("maintenance", PURGE_KIND)).toBe(purgeHandler);
  });
  it("retention with no payload is a dry run: it never updates", async () => {
    const calls: string[] = [];
    const chain = (t: string) => { const b: Record<string, unknown> = {}; for (const m of ["select", "eq", "in", "is", "lt", "neq", "or", "order", "limit"]) b[m] = () => b; b.update = () => { calls.push(`update:${t}`); return b; }; b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: t === "retention_policies" ? [{ tenant_id: "t", object_type: "lead", days: 10, action: "delete" }] : t === "workspaces" ? [{ id: "w" }] : [{ id: "a" }], error: null }).then(r); return b; };
    const c = ctx({ from: chain });
    expect(await retentionHandler(undefined as never, c)).toBe("done");
    expect(calls).toEqual([]);
    expect(c.log.lines.some((l) => l.msg === "retention policy" && l.f?.mode === "plan" && l.f?.matched === 1 && l.f?.changed === 0)).toBe(true);
  });
  it("purge refuses fewer than 30 days and does not call the database", async () => {
    let called = false;
    const c = ctx({ rpc: () => { called = true; return Promise.resolve({ data: null, error: null }); } });
    expect(await purgeHandler({ retention_days: 7 }, c)).toBe("done");
    expect(called).toBe(false);
    expect(c.log.lines.some((l) => l.level === "warn")).toBe(true);
  });
  it("purge calls privacy_purge with the days, and treats a missing function as done", async () => {
    const seen: unknown[] = [];
    expect(await purgeHandler({ retention_days: 90 }, ctx({ rpc: (fn: string, a: unknown) => { seen.push([fn, a]); return Promise.resolve({ data: { leads: 1 }, error: null }); } }))).toBe("done");
    expect(seen).toEqual([["privacy_purge", { p_days: 90 }]]);
    expect(await purgeHandler({}, ctx({ rpc: () => Promise.resolve({ data: null, error: { code: "PGRST202" } }) }))).toBe("done");
    expect(await purgeHandler({}, ctx({ rpc: () => Promise.resolve({ data: null, error: { code: "57014" } }) }))).toBe("retry");
  });
});
