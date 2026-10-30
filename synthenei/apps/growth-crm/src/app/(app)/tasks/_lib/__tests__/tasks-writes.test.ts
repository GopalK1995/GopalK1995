import { describe, expect, it } from "vitest";
import { createTasksRepo } from "@/lib/db/repo/tasks";
import { runAction } from "@/lib/actions/result";
import { err, has, mockDb, ok } from "@/lib/db/__tests__/mock";
import { vocabFor } from "@/lib/vertical";
import * as P from "../persist";
import { normTasks } from "../rows";
import { createTaskSchema, editTaskSchema, idsSchema, reassignSchema, rescheduleSchema } from "../schemas";
import { tt, ttAll } from "../strings";

const WS = "11111111-1111-4111-8111-111111111111";
const UID = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const row = { id: "T1", title: "Call", version: 2, assigneeId: UID };
const mk = (results: Parameters<typeof mockDb>[0]) => {
  const { db, calls } = mockDb(results);
  const c: P.Ctx = { ws: WS, uid: UID, now: new Date("2026-10-29T06:00:00Z"), repos: { tasks: createTasksRepo(() => Promise.resolve(db)) } };
  return { c, calls };
};

describe("schemas", () => {
  it("create needs a title, a known kind and priority, a valid due", () => {
    const base = { title: "Call Asha", kind: "call", due: "2026-11-01T10:00:00Z", priority: "normal" };
    expect(createTaskSchema.safeParse(base).success).toBe(true);
    expect(createTaskSchema.safeParse({ ...base, title: "ab" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, kind: "visit" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, due: "soon" }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...base, leadId: "not-a-uuid" }).success).toBe(false);
  });
  it("edit, reschedule and reassign need a version; edit needs a change", () => {
    expect(editTaskSchema.safeParse({ expectedVersion: 1, patch: {} }).success).toBe(false);
    expect(editTaskSchema.safeParse({ patch: { title: "New title" } }).success).toBe(false);
    expect(editTaskSchema.safeParse({ expectedVersion: 1, patch: { title: "New title" } }).success).toBe(true);
    expect(rescheduleSchema.safeParse({ due: "2026-11-01T10:00:00Z" }).success).toBe(false);
    expect(reassignSchema.safeParse({ expectedVersion: 1, ownerId: "x" }).success).toBe(false);
    expect(idsSchema.safeParse([]).success).toBe(false);
  });
});

describe("persistence", () => {
  it("create inserts into the workspace, default assignee = caller, priority as 1..3", async () => {
    const { c, calls } = mk([ok({ ...row, id: "NEW", version: 1 })]);
    const r = await P.create(c, createTaskSchema.parse({ title: "Call Asha", kind: "call", due: "2026-11-01T10:00:00Z", priority: "high" }), { created: "Task created" });
    expect(r).toMatchObject({ ok: true, data: { id: "NEW", version: 1 } });
    const ins = calls[0].ops.find(([o]) => o === "insert")![1][0] as Record<string, unknown>;
    expect(ins).toMatchObject({ workspace_id: WS, assignee_id: UID, created_by: UID, priority: 1, kind: "call", status: "open" });
  });
  it("reschedule and reassign are version guarded", async () => {
    const a = mk([ok([{ ...row, version: 3 }])]);
    const r = await P.reschedule(a.c, "T1", 2, "2026-11-02T04:30:00Z", { moved: "Moved" });
    expect(r).toMatchObject({ ok: true, data: { version: 3 } });
    expect(has(a.calls[0], "eq", "version", 2)).toBe(true);
    const upd = a.calls[0].ops.find(([o]) => o === "update")![1][0] as Record<string, unknown>;
    expect(upd).toEqual({ due_at: "2026-11-02T04:30:00.000Z" });
    const b = mk([ok([{ ...row, version: 3 }])]);
    await P.reassign(b.c, "T1", 2, OTHER, { reassigned: "x" });
    expect(b.calls[0].ops.find(([o]) => o === "update")![1][0]).toEqual({ assignee_id: OTHER });
  });
  it("a stale version becomes a conflict carrying only the current row, never a success", async () => {
    const { c } = mk([ok([]), ok({ ...row, version: 9 })]);
    const r = await runAction(() => P.edit(c, "T1", 2, { title: "Other" }, { saved: "Saved" }));
    expect(r).toMatchObject({ ok: false, code: "conflict", current: { version: 9 } });
  });
  it("RLS denial surfaces as denied; missing row as not_found", async () => {
    expect(await runAction(() => P.reassign(mk([err("42501")]).c, "T1", 1, OTHER, { reassigned: "x" }))).toMatchObject({ ok: false, code: "denied" });
    expect(await runAction(() => P.reschedule(mk([ok([]), ok(null)]).c, "T1", 1, "2026-11-01T10:00:00Z", { moved: "x" }))).toMatchObject({ ok: false, code: "not_found" });
  });
  it("complete marks only still-open tasks in this workspace", async () => {
    const { c, calls } = mk([ok(null)]);
    const r = await P.complete(c, ["T1", "T2"], { done: "2 tasks marked done" });
    expect(r.ok).toBe(true);
    expect(has(calls[0], "eq", "workspace_id", WS)).toBe(true);
    expect(has(calls[0], "is", "completed_at", null)).toBe(true);
  });
});

describe("normTasks", () => {
  it("maps real rows: assigneeId to ownerId, numeric priority, unknown kinds, hides done and cancelled", () => {
    const out = normTasks([
      { id: "a", title: "x", kind: "demo_prep", assigneeId: UID, priority: 1, status: "open", dueAt: "2026-11-01T04:00:00Z", version: 4 },
      { id: "b", title: "y", kind: "first_response", assigneeId: UID, priority: 3, status: "snoozed", dueAt: "2026-11-01T04:00:00Z", version: 1 },
      { id: "c", title: "z", kind: "other", assigneeId: UID, priority: 2, status: "done", dueAt: "2026-11-01T04:00:00Z", version: 1 },
      { id: "d", title: "w", kind: "call", assigneeId: UID, priority: 2, status: "cancelled", dueAt: "2026-11-01T04:00:00Z", version: 1 },
    ]);
    expect(out.map((x) => x.id)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({ ownerId: UID, kind: "demo", priority: "high", version: 4, firstResponse: false });
    expect(out[1]).toMatchObject({ kind: "call", priority: "low", firstResponse: true, status: "open" });
  });
  it("keeps demo tasks as they are (no version)", () => {
    const out = normTasks([{ id: "a", title: "x", kind: "call", ownerId: "u", priority: "high", status: "open", dueAt: "2026-11-01T04:00:00Z", leadId: "L", dealId: null }]);
    expect(out[0]).toMatchObject({ ownerId: "u", priority: "high", version: null });
  });
});

describe("vocabulary per vertical", () => {
  const legal = vocabFor({ id: "t", vertical: "legal" } as never), hosp = vocabFor({ id: "t", vertical: "hospitality" } as never);
  it("never shares nouns across tenants", () => {
    expect(tt(legal)("leadNotFound")).toMatch(/^Lead not found/);
    expect(tt(hosp)("leadNotFound")).toMatch(/^Enquiry not found/);
    expect(tt(hosp)("leadNotFound")).not.toMatch(/lead/i);
    expect(ttAll(hosp).ownLeads).not.toMatch(/lead/i);
    expect(tt(legal)("doneOne", { title: "Call" })).toBe("Done: Call");
  });
});
