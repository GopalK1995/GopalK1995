import { describe, expect, it } from "vitest";
import { createLeadsRepo } from "@/lib/db/repo/leads";
import { createActivitiesRepo } from "@/lib/db/repo/activities";
import { createTasksRepo } from "@/lib/db/repo/tasks";
import { DbError } from "@/lib/db/errors";
import { runAction } from "@/lib/actions/result";
import { err, has, mockDb, ok } from "@/lib/db/__tests__/mock";
import type { Lead } from "@/lib/db/repo/types";
import { vocabFor } from "@/lib/vertical";
import * as P from "../persist";
import { assignSchema, callSchema, createLeadSchema, demoSchema, statusSchema, updateLeadSchema } from "../schemas";
import { lt } from "../strings";

const WS = "11111111-1111-4111-8111-111111111111";
const UID = "22222222-2222-4222-8222-222222222222";
const lead = { id: "L1", fullName: "Asha Rao", ownerId: UID, firstResponseAt: null, version: 3, phone: "9876543210", email: "asha@firm.in", roleTitle: "Partner", firmName: "Rao & Co", city: "Madurai", status: "new", score: 50, source: "manual", createdAt: "2026-10-01", lastTouchAt: null } as unknown as Lead;
const mk = (results: Parameters<typeof mockDb>[0]) => {
  const { db, calls } = mockDb(results);
  const g = () => Promise.resolve(db);
  const c: P.Ctx = { ws: WS, uid: UID, now: new Date("2026-10-29T06:00:00Z"), repos: { leads: createLeadsRepo(g), activities: createActivitiesRepo(g), tasks: createTasksRepo(g) } };
  return { c, calls };
};

describe("input schemas", () => {
  it("create requires a name and a phone or email", () => {
    expect(createLeadSchema.safeParse({ fullName: "" , email: "a@b.in" }).success).toBe(false);
    expect(createLeadSchema.safeParse({ fullName: "Asha" }).success).toBe(false);
    expect(createLeadSchema.safeParse({ fullName: "Asha", phone: "98765 43210" }).success).toBe(true);
    expect(createLeadSchema.safeParse({ fullName: "Asha", email: "nope" }).success).toBe(false);
  });
  it("update needs a version and at least one field", () => {
    expect(updateLeadSchema.safeParse({ expectedVersion: 1, patch: {} }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ patch: { city: "x" } }).success).toBe(false);
    expect(updateLeadSchema.safeParse({ expectedVersion: 2, patch: { city: "Madurai" } }).success).toBe(true);
  });
  it("status: disqualify needs a known reason; unknown status rejected", () => {
    expect(statusSchema.safeParse({ status: "disqualified" }).success).toBe(false);
    expect(statusSchema.safeParse({ status: "disqualified", reason: "spam" }).success).toBe(true);
    expect(statusSchema.safeParse({ status: "won" }).success).toBe(false);
  });
  it("call, demo and assign bounds", () => {
    expect(callSchema.safeParse({ outcome: "connected", minutes: 300, notes: "", nextDate: "" }).success).toBe(false);
    expect(callSchema.safeParse({ outcome: "connected", minutes: 4, notes: "", nextDate: "2026-11-01" }).success).toBe(true);
    expect(demoSchema.safeParse({ date: "2026-11-01", time: "17:30", minutes: 30, mode: "Meet" }).success).toBe(true);
    expect(demoSchema.safeParse({ date: "1 Nov", time: "17:30", minutes: 30, mode: "Meet" }).success).toBe(false);
    expect(assignSchema.safeParse({ ids: [], ownerId: "x" }).success).toBe(false);
  });
});

describe("persistence", () => {
  it("createLead inserts into the workspace with the caller as default owner and manual source", async () => {
    const { c, calls } = mk([ok({ ...lead, id: "NEW" })]);
    const r = await P.createLead(c, createLeadSchema.parse({ fullName: "Asha Rao", phone: "9876543210" }), { created: "Lead added" });
    expect(r).toMatchObject({ ok: true, message: "Lead added", data: { id: "NEW" } });
    const ins = calls[0].ops.find(([o]) => o === "insert")![1][0] as Record<string, unknown>;
    expect(ins).toMatchObject({ full_name: "Asha Rao", owner_id: UID, workspace_id: WS, source: "manual" });
  });
  it("updates are version guarded and return the new version", async () => {
    const { c, calls } = mk([ok([{ ...lead, version: 4 }])]);
    const r = await P.setStatus(c, lead, 3, "disqualified", "spam", { saved: "Saved" });
    expect(r).toMatchObject({ ok: true, data: { version: 4 } });
    expect(has(calls[0], "eq", "version", 3)).toBe(true);
    expect(has(calls[0], "eq", "workspace_id", WS)).toBe(true);
  });
  it("a stale version becomes a conflict through runAction, never a success", async () => {
    const { c } = mk([ok([]), ok({ ...lead, version: 9 })]);
    const r = await runAction(() => P.updateLead(c, "L1", 3, { city: "x" }, { saved: "Saved" }));
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ code: "conflict", current: { version: 9 } });
  });
  it("RLS denial surfaces as denied", async () => {
    const { c } = mk([err("42501")]);
    const r = await runAction(() => P.assign(c, ["L1"], UID, { assigned: "x" }));
    expect(r).toMatchObject({ ok: false, code: "denied" });
  });
  it("logCall writes an activity, a follow-up task, then bumps first response and next step", async () => {
    const { c, calls } = mk([ok({ id: "A1" }), ok({ id: "T1" }), ok([{ ...lead, version: 4 }])]);
    const r = await P.logCall(c, lead, 3, { outcome: "connected", minutes: 4, notes: "ok", nextDate: "2026-10-30" }, { saved: "Call logged", followUp: "Follow up" });
    expect(r.ok).toBe(true);
    expect(calls.map((x) => x.table)).toEqual(["activities", "tasks", "leads"]);
    const upd = calls[2].ops.find(([o]) => o === "update")![1][0] as Record<string, unknown>;
    expect(upd.first_response_at).toBe("2026-10-29T06:00:00.000Z");
    expect(upd.next_step_at).toBe("2026-10-30T04:30:00.000Z");
  });
  it("scheduleDemo creates a meeting activity and a prep task (calendar placeholder)", async () => {
    const { c, calls } = mk([ok({ id: "A" }), ok({ id: "T" })]);
    await P.scheduleDemo(c, lead, { date: "2026-11-02", time: "17:30", minutes: 30, mode: "Google Meet" }, { saved: "ok", prep: "Prep" });
    expect(calls.map((x) => x.table)).toEqual(["activities", "tasks"]);
    const act = calls[0].ops.find(([o]) => o === "insert")![1][0] as Record<string, unknown>;
    expect(act).toMatchObject({ kind: "meeting", meeting_type: "demo", scheduled_at: "2026-11-02T12:00:00.000Z" });
  });
  it("DbError is what runAction maps, so message text never leaks internals", async () => {
    const r = await runAction(async () => { throw new DbError("not_found"); });
    expect(r).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("export masking", () => {
  const rows = [lead];
  it("masks name, phone and email when masked", () => {
    const csv = P.buildCsv(rows, { maskPersonal: true, ownerNames: { [UID]: "Meena" } });
    expect(csv).not.toContain("Asha Rao");
    expect(csv).not.toContain("9876543210");
    expect(csv).not.toContain("asha@firm.in");
    expect(csv).toContain("A. R.");
  });
  it("includes personal data only when unmasked", () => {
    const csv = P.buildCsv(rows, { maskPersonal: false, ownerNames: { [UID]: "Meena" } });
    expect(csv).toContain("Asha Rao");
    expect(csv).toContain("asha@firm.in");
  });
});

describe("vertical vocabulary", () => {
  const legal = lt(vocabFor({ id: "t", vertical: "legal" } as never));
  const hosp = lt(vocabFor({ id: "t", vertical: "hospitality" } as never));
  it("legal says lead, hospitality says enquiry, never crossed", () => {
    expect(legal("created")).toBe("Lead added");
    expect(hosp("created")).toBe("Enquiry added");
    expect(legal("create.title")).not.toMatch(/enquir/i);
    expect(hosp("create.title")).not.toMatch(/\blead/i);
    expect(hosp("conflictTitle")).not.toMatch(/\blead/i);
    expect(legal("conflictTitle")).not.toMatch(/enquir/i);
  });
});
