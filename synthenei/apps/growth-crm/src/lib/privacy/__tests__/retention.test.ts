import { describe, expect, it } from "vitest";
import { BATCH, MAX_BATCHES, planPolicy, runRetention, supabaseRetentionPort, targetFor, type Policy, type RetentionPort } from "../retention";
import { fakeDb } from "./fake-db";

const NOW = Date.UTC(2026, 10, 21);
const pol = (objectType: string, action: Policy["action"], days = 100): Policy => ({ tenantId: "t1", objectType, days, action });

function port(batches: string[][], policies: Policy[]) {
  const applied: { table: string; ids: string[]; patch: Record<string, unknown> }[] = [];
  let i = 0;
  const p: RetentionPort = {
    policies: async () => policies, workspaces: async () => ["w1"],
    due: async () => batches[i++] ?? [],
    apply: async (t, ids, patch) => { applied.push({ table: t.table, ids, patch }); },
  };
  return { p, applied };
}

describe("planPolicy", () => {
  it("cutoff is now minus days", () => {
    expect(planPolicy(pol("lead", "delete", 10), NOW).cutoff).toBe(new Date(NOW - 10 * 86_400_000).toISOString());
  });
  it("delete on leads and custom objects is a SOFT delete; everything else clears content", () => {
    expect(planPolicy(pol("lead", "delete"), NOW).kind).toBe("soft_delete");
    expect(planPolicy(pol("obj:booking", "delete"), NOW).kind).toBe("soft_delete");
    expect(planPolicy(pol("lead", "anonymise"), NOW).kind).toBe("anonymise");
    for (const o of ["activity", "message", "lead_event"]) expect(planPolicy(pol(o, "delete"), NOW).kind).toBe("anonymise");
  });
  it("unknown object types are unsupported, never guessed", () => {
    expect(planPolicy(pol("payments", "delete"), NOW).kind).toBe("unsupported");
    expect(planPolicy(pol("obj:Bad Key", "delete"), NOW).kind).toBe("unsupported");
    expect(targetFor("invoices")).toBeNull();
  });
});

describe("runRetention", () => {
  it("plan mode counts and changes nothing", async () => {
    const { p, applied } = port([["a", "b"]], [pol("lead", "delete")]);
    const out = await runRetention(p, { mode: "plan", tenantId: null, now: NOW, deadline: Date.now() + 60_000 });
    expect(out[0]).toMatchObject({ kind: "soft_delete", matched: 2, changed: 0 });
    expect(applied).toHaveLength(0);
  });
  it("apply soft-deletes by setting deleted_at, never removing rows", async () => {
    const { p, applied } = port([["a", "b"]], [pol("lead", "delete")]);
    const out = await runRetention(p, { mode: "apply", tenantId: null, now: NOW, deadline: Date.now() + 60_000 });
    expect(out[0]).toMatchObject({ matched: 2, changed: 2 });
    expect(applied[0]).toMatchObject({ table: "leads", ids: ["a", "b"], patch: { deleted_at: "now" } });
  });
  it("anonymise clears personal fields", async () => {
    const { p, applied } = port([["a"]], [pol("lead", "anonymise")]);
    await runRetention(p, { mode: "apply", tenantId: null, now: NOW, deadline: Date.now() + 60_000 });
    expect(applied[0].patch).toMatchObject({ full_name: "Anonymised lead", email: null, phone: null });
  });
  it("message and activity retention clears the body, it does not delete the row", async () => {
    const { p, applied } = port([["m1"], ["a1"]], [pol("message", "delete"), pol("activity", "delete")]);
    await runRetention(p, { mode: "apply", tenantId: null, now: NOW, deadline: Date.now() + 60_000 });
    expect(applied.map((a) => [a.table, a.patch])).toEqual([["messages", { body: null }], ["activities", { body: null, subject: null }]]);
  });
  it("is bounded: at most MAX_BATCHES batches per policy, then reports capped", async () => {
    const full = Array.from({ length: BATCH }, (_, i) => `id${i}`);
    const { p, applied } = port(Array.from({ length: MAX_BATCHES + 5 }, () => full), [pol("lead", "anonymise")]);
    const out = await runRetention(p, { mode: "apply", tenantId: null, now: NOW, deadline: Date.now() + 60_000 });
    expect(applied).toHaveLength(MAX_BATCHES);
    expect(out[0].capped).toBe(true);
  });
  it("stops at the deadline", async () => {
    const { p, applied } = port([["a"]], [pol("lead", "anonymise")]);
    const out = await runRetention(p, { mode: "apply", tenantId: null, now: NOW, deadline: Date.now() - 1 });
    expect(applied).toHaveLength(0);
    expect(out[0].capped).toBe(true);
  });
  it("one failing policy does not stop the others", async () => {
    const { p, applied } = port([["a"]], [pol("lead", "anonymise"), pol("payments", "delete")]);
    const out = await runRetention(p, { mode: "apply", tenantId: null, now: NOW, deadline: Date.now() + 60_000 });
    expect(out[1].error).toBeTruthy();
    expect(applied).toHaveLength(1);
  });
});

describe("supabaseRetentionPort", () => {
  it("due() only reads live, unscrubbed rows older than the cutoff, scoped to the tenant's workspaces", async () => {
    const f = fakeDb({ tables: { leads: [{ id: "a" }] } });
    const ids = await supabaseRetentionPort(f.db).due(targetFor("lead")!, ["w1"], "2026-01-01T00:00:00.000Z", null, 10);
    expect(ids).toEqual(["a"]);
    const q = f.ops[0];
    expect(q.op).toBe("select");
    expect(q.filters).toEqual(expect.arrayContaining([["in:workspace_id", ["w1"]], ["lt:created_at", "2026-01-01T00:00:00.000Z"], ["is:deleted_at", null], ["neq:full_name", "Anonymised lead"]]));
  });
  it("apply() updates by id only (no delete ever issued)", async () => {
    const f = fakeDb();
    await supabaseRetentionPort(f.db).apply(targetFor("lead")!, ["a"], { deleted_at: "now" });
    expect(f.ops.every((o) => o.op !== "delete")).toBe(true);
    const u = f.ops.find((o) => o.op === "update")!;
    expect(u.filters).toEqual([["in:id", ["a"]]]);
    expect(typeof (u.payload as { deleted_at: string }).deleted_at).toBe("string");
    expect((u.payload as { deleted_at: string }).deleted_at).not.toBe("now");
  });
});
