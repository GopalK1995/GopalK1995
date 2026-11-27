import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobContext } from "@/lib/jobs/registry";
import { memLogger } from "@/lib/jobs/__tests__/fakes";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/events/emit", () => ({ emitEvent: vi.fn(async () => "1") }));
const { getHandler } = await import("@/lib/jobs/registry");
const { DSR_DUE_KIND, dsrDueHandler } = await import("../job");
const { emitEvent } = await import("@/lib/events/emit");

const ctx = (db: unknown): JobContext & { log: ReturnType<typeof memLogger> } => ({ runId: 1, attempt: 1, tenantId: null, log: memLogger(), deadline: Date.now() + 60_000, db: db as SupabaseClient });

// A tiny table-driven stand-in: select chains answer from fixtures, inserts are recorded.
function db(over: { due?: Record<string, unknown>[]; purge?: { code: string } | null } = {}) {
  const inserted: { table: string; rows: unknown }[] = [];
  const answers: Record<string, unknown[]> = {
    privacy_requests: over.due ?? [], memberships: [{ user_id: "owner-1" }], notification_rules: [], events: [], notifications: [],
  };
  const chain = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "lte", "order", "limit"]) b[m] = () => b;
    b.insert = (rows: unknown) => { inserted.push({ table, rows }); return b; };
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: answers[table] ?? [], error: null }).then(r);
    return b;
  };
  return { db: { from: chain, rpc: (fn: string) => Promise.resolve({ data: 0, error: fn === "privacy_tokens_purge" ? over.purge ?? null : null }) }, inserted };
}

describe("privacy.dsr_due job", () => {
  it("registers on the maintenance queue", () => { expect(getHandler("maintenance", DSR_DUE_KIND)).toBe(dsrDueHandler); });

  it("alerts the owner about a request due in 3 days and logs counts only", async () => {
    vi.mocked(emitEvent).mockClear();
    const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const x = db({ due: [{ id: "r1", workspace_id: "w1", tenant_id: "t1", kind: "access", status: "received", due_at: due }] });
    const c = ctx(x.db);
    expect(await dsrDueHandler({}, c)).toBe("done");
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "privacy.request_due_soon", objectId: "r1", workspaceId: "w1" }), expect.anything());
    expect(x.inserted).toHaveLength(1);
    expect(x.inserted[0].table).toBe("notifications");
    expect(JSON.stringify(c.log.lines)).not.toMatch(/@/);
    expect(c.log.lines.some((l) => l.msg === "privacy.dsr_due" && l.f?.due_soon === 1)).toBe(true);
  });

  it("a missing purge function (0032 not applied) is not a failure", async () => {
    const c = ctx(db({ purge: { code: "PGRST202" } }).db);
    expect(await dsrDueHandler({}, c)).toBe("done");
    expect(c.log.lines.filter((l) => l.level === "warn")).toHaveLength(0);
  });
});
