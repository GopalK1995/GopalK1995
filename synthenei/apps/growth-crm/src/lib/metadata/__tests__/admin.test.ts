import { describe, expect, it, vi } from "vitest";
import { DbError } from "@/lib/db/errors";
import { buildAuditArgs } from "@/lib/audit/record";
import type { AuditActor } from "@/lib/audit/types";
import { createFieldDef, moveFieldDef, restoreFieldDef, retireFieldDef, updateFieldDef, type AdminCtx, type AdminDeps } from "../admin";
import { diffField, fieldFromInput, fieldInputSchema, inputFromField, keyFromLabel, reconcileChoices, reorder, rowFromField } from "../defs";
import { ft } from "../strings";
import type { FieldDef } from "../types";
import { def } from "./fixtures";

const actor: AuditActor = { uid: "u1", kind: "user", workspaceId: "w1", source: "ui", impersonation: false };

function mk(store: FieldDef[] = [], o: Partial<AdminDeps> & { limit?: { max: number | null; used: number }; withValues?: number } = {}) {
  const calls: string[] = [];
  const deps: AdminDeps = {
    getFieldByKey: async (_ot, key) => store.find((f) => f.key === key) ?? null,
    listFields: async () => store,
    insertField: vi.fn(async (_ot, row, position) => { calls.push("insert"); const f = def({ key: String(row.key), type: row.type as FieldDef["type"], position, ...(row as object) } as never); store.push(f); return f; }),
    updateFieldGuarded: vi.fn(async (id, rev, patch) => {
      calls.push("update");
      const cur = store.find((f) => f.id === id)!;
      if (cur.rev !== rev) throw new DbError("conflict", "conflict", { current: { rev: cur.rev } });
      Object.assign(cur, "archived_at" in patch ? { archivedAt: patch.archived_at as string | null } : {}, patch.options ? { options: patch.options as FieldDef["options"] } : {}, patch.label ? { label: patch.label as FieldDef["label"] } : {}, patch.required !== undefined ? { required: patch.required as boolean } : {});
      cur.rev = `${cur.rev}+`;
      return cur;
    }),
    setPositions: vi.fn(async (items) => { calls.push("positions"); for (const it of items) store.find((f) => f.id === it.id)!.position = it.position; }),
    fieldLimit: async () => o.limit ?? { max: null, used: store.length },
    countWithValue: async () => o.withValues ?? 0,
    audit: vi.fn(async (a, i) => { calls.push(`audit:${i.action}`); buildAuditArgs(a, i); }),
    emit: vi.fn(async () => { calls.push("emit"); }),
    ...o,
  };
  const ctx: AdminCtx = { ws: "w1", tenantId: "t1", objectKey: "lead", objectTypeId: "ot1", actor, t: (k, v) => ft(k, { noun: "lead", ...v }), deps };
  return { ctx, deps, calls, store };
}
const input = (p: Record<string, unknown> = {}) => fieldInputSchema.parse({ objectKey: "lead", key: "deal_size", label: { en: "Deal size" }, type: "money", ...p });

describe("input schema", () => {
  it("accepts each editor type", () => {
    for (const type of ["text", "long_text", "number", "money", "date", "datetime", "boolean", "url", "email", "phone", "user"]) {
      expect(fieldInputSchema.safeParse({ objectKey: "lead", key: "k_" + type, label: { en: "L" }, type }).success).toBe(true);
    }
    expect(fieldInputSchema.safeParse({ objectKey: "lead", key: "stage_x", label: { en: "L" }, type: "select", choices: [{ key: "a", label: { en: "A" } }] }).success).toBe(true);
    expect(fieldInputSchema.safeParse({ objectKey: "lead", key: "rel", label: { en: "L" }, type: "lookup", lookupObject: "account" }).success).toBe(true);
  });
  it("rejects bad keys, empty option lists, duplicate option keys, missing lookup, unique booleans, bad defaults", () => {
    const base = { objectKey: "lead", label: { en: "L" } };
    expect(fieldInputSchema.safeParse({ ...base, key: "Bad Key", type: "text" }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, key: "pick", type: "select", choices: [] }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, key: "pick", type: "select", choices: [{ key: "a", label: { en: "A" } }, { key: "a", label: { en: "B" } }] }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, key: "rel", type: "lookup" }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, key: "flag", type: "boolean", uniqueInWorkspace: true }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, key: "size", type: "number", default: "abc" }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, key: "size", type: "number", validation: { min: 5, max: 1 } }).success).toBe(false);
    expect(fieldInputSchema.safeParse({ ...base, key: "code", type: "text", validation: { pattern: "([" } }).success).toBe(false);
  });
  it("stores money as INR, coerces the default, and keeps access roles in options", () => {
    const f = fieldFromInput(input({ default: "₹1,000", viewRoles: ["owner"], editRoles: ["owner", "sales_manager"] }));
    expect(f.options).toEqual({ currency: "INR", access: { viewRoles: ["owner"], editRoles: ["owner", "sales_manager"] } });
    expect(f.default).toBe(1000);
    expect(rowFromField(f)).toMatchObject({ key: "deal_size", type: "money", is_pii: false, unique_in_workspace: false });
  });
  it("keyFromLabel always yields a legal key", () => {
    expect(keyFromLabel("Deal size (INR)")).toBe("deal_size_inr");
    expect(keyFromLabel("123")).toBe("field");
    expect(keyFromLabel("தமிழ்")).toBe("field");
  });
  it("round trips through inputFromField", () => {
    const f = def({ key: "src", type: "select", options: { choices: [{ key: "a", label: { en: "A", ta: "அ" }, color: "info" }] }, required: true });
    expect(fieldFromInput(fieldInputSchema.parse(inputFromField("lead", f))).options.choices).toEqual([{ key: "a", label: { en: "A", ta: "அ" }, color: "info" }]);
  });
});

describe("createFieldDef", () => {
  it("writes, audits (after) and announces", async () => {
    const m = mk();
    const r = await createFieldDef(m.ctx, input());
    expect(r.ok).toBe(true);
    expect(m.calls).toEqual(["insert", "audit:fields.created", "emit"]);
    expect(m.deps.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "metadata.changed", data: expect.objectContaining({ field: "deal_size", change: "created" }) }));
  });
  it("respects org_admin_policies.max_custom_fields", async () => {
    const m = mk([], { limit: { max: 3, used: 3 } });
    const r = await createFieldDef(m.ctx, input());
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(m.calls).toEqual([]);
  });
  it("refuses a key that already exists (also when retired)", async () => {
    const m = mk([def({ key: "deal_size", type: "money", archivedAt: "2026-01-01" })]);
    expect(await createFieldDef(m.ctx, input())).toMatchObject({ ok: false, code: "invalid", issues: [{ path: "key" }] });
  });
  it("says so when the audit row could not be written, instead of hiding it", async () => {
    const m = mk([], { audit: vi.fn(async () => { throw new Error("audit down"); }) });
    const log = vi.fn();
    const r = await createFieldDef({ ...m.ctx, log }, input());
    expect(r.ok && r.sub).toContain("audit entry could not be written");
    expect(log).toHaveBeenCalled();
  });
  it("an event failure does not fail the save", async () => {
    const m = mk([], { emit: vi.fn(async () => { throw new Error("bus down"); }) });
    expect((await createFieldDef({ ...m.ctx, log: () => {} }, input())).ok).toBe(true);
  });
});

describe("updateFieldDef (versioned)", () => {
  const existing = () => def({ key: "deal_size", type: "money", label: { en: "Deal size" }, rev: "r1", isFilterable: false });
  it("saves with the loaded revision and reports the changed properties in the audit detail", async () => {
    const m = mk([existing()]);
    const r = await updateFieldDef(m.ctx, input({ label: { en: "Deal value" }, required: true }), "r1");
    expect(r.ok).toBe(true);
    expect(m.deps.audit).toHaveBeenCalledWith(actor, expect.objectContaining({ action: "fields.updated", detail: expect.objectContaining({ changes: expect.arrayContaining(["label", "required"]) }) }));
  });
  it("a stale revision is a conflict that carries only the new token", async () => {
    const m = mk([existing()]);
    const r = await updateFieldDef(m.ctx, input({ label: { en: "X" } }), "old");
    expect(r).toMatchObject({ ok: false, code: "conflict", current: { rev: "r1" } });
    expect(JSON.stringify(r)).not.toContain("Deal size");
    expect(m.deps.updateFieldGuarded).not.toHaveBeenCalled();
  });
  it("loses a race between the check and the write the same way", async () => {
    const m = mk([existing()], { updateFieldGuarded: vi.fn(async () => { throw new DbError("conflict", "conflict", { current: { rev: "r9" } }); }) });
    expect(await updateFieldDef(m.ctx, input({ label: { en: "X" } }), "r1")).toMatchObject({ ok: false, code: "conflict", current: { rev: "r9" } });
  });
  it("type cannot change once records have values", async () => {
    const m = mk([existing()], { withValues: 3 });
    expect(await updateFieldDef(m.ctx, input({ type: "number" }), "r1")).toMatchObject({ ok: false, code: "invalid", issues: [{ path: "type" }] });
  });
  it("no changes writes nothing", async () => {
    const m = mk([existing()]);
    const r = await updateFieldDef(m.ctx, input(), "r1");
    expect(r.ok).toBe(true);
    expect(m.calls).toEqual([]);
  });
  it("removing an option retires it (kept, archived) rather than dropping it", async () => {
    const f = def({ key: "src", type: "select", rev: "r1", options: { choices: [{ key: "a", label: { en: "A" } }, { key: "b", label: { en: "B" } }] } });
    const m = mk([f]);
    const r = await updateFieldDef(m.ctx, fieldInputSchema.parse({ objectKey: "lead", key: "src", label: { en: "src" }, type: "select", isFilterable: true, choices: [{ key: "a", label: { en: "A" } }] }), "r1");
    expect(r.ok).toBe(true);
    expect(f.options.choices).toEqual([{ key: "a", label: { en: "A" } }, { key: "b", label: { en: "B" }, archived: true }]);
  });
  it("retiring an option that records use needs a reason and is audited before the write", async () => {
    const f = def({ key: "src", type: "select", rev: "r1", options: { choices: [{ key: "a", label: { en: "A" } }, { key: "b", label: { en: "B" } }] } });
    const m = mk([f], { withValues: 2 });
    const body = fieldInputSchema.parse({ objectKey: "lead", key: "src", label: { en: "src" }, type: "select", isFilterable: true, choices: [{ key: "a", label: { en: "A" } }] });
    expect(await updateFieldDef(m.ctx, body, "r1")).toMatchObject({ ok: false, code: "invalid", issues: [{ path: "reason" }] });
    expect(m.calls).toEqual([]);
    expect((await updateFieldDef(m.ctx, body, "r1", "Superseded by the new source list")).ok).toBe(true);
    expect(m.calls).toEqual(["audit:config.field_options_retired", "update", "emit"]);
  });
  it("a retired field cannot be edited", async () => {
    const m = mk([{ ...existing(), archivedAt: "2026-01-01" }]);
    expect(await updateFieldDef(m.ctx, input(), "r1")).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("retire and restore (never a hard delete)", () => {
  const f = () => def({ key: "deal_size", type: "money", rev: "r1" });
  it("needs a reason of 8+ characters; nothing is touched without it", async () => {
    const m = mk([f()]);
    expect(await retireFieldDef(m.ctx, "deal_size", "r1", "short")).toMatchObject({ ok: false, code: "invalid" });
    expect(m.calls).toEqual([]);
  });
  it("audits BEFORE the write, sets archived_at, keeps the values and says so", async () => {
    const m = mk([f()], { withValues: 12 });
    const r = await retireFieldDef(m.ctx, "deal_size", "r1", "Replaced by deal value");
    expect(m.calls).toEqual(["audit:config.field_retired", "update", "emit"]);
    expect(r.ok && r.message).toContain("Existing values are kept");
    expect(r.ok && r.data?.withValues).toBe(12);
    expect(m.store[0].archivedAt).toBeTruthy();
    expect(m.deps.updateFieldGuarded).toHaveBeenCalledWith(expect.any(String), "r1", { archived_at: expect.any(String) });
  });
  it("fails closed when the audit row cannot be written: the field is not retired", async () => {
    const m = mk([f()], { audit: vi.fn(async () => { throw new Error("audit down"); }) });
    await expect(retireFieldDef(m.ctx, "deal_size", "r1", "Replaced by deal value")).rejects.toThrow("audit down");
    expect(m.store[0].archivedAt).toBeNull();
  });
  it("stale revision is a conflict", async () => {
    const m = mk([f()]);
    expect(await retireFieldDef(m.ctx, "deal_size", "zzz", "Replaced by deal value")).toMatchObject({ ok: false, code: "conflict" });
  });
  it("restore clears archived_at and audits", async () => {
    const m = mk([{ ...f(), archivedAt: "2026-01-01" }]);
    const r = await restoreFieldDef(m.ctx, "deal_size", "r1");
    expect(r.ok).toBe(true);
    expect(m.store[0].archivedAt).toBeNull();
    expect(m.calls).toEqual(["update", "audit:fields.restored", "emit"]);
  });
  it("the admin module has no delete path", async () => {
    const src = await import("../admin");
    expect(Object.keys(src).join(",")).not.toMatch(/delete/i);
  });
});

describe("ordering", () => {
  it("reorder swaps neighbours and ignores the ends", () => {
    const fs = [def({ key: "a", type: "text", position: 0 }), def({ key: "b", type: "text", position: 1 }), def({ key: "c", type: "text", position: 2 })];
    expect(reorder(fs, "b", -1).map((p) => p.position)).toEqual([0, 1]);
    expect(reorder(fs, "a", -1)).toEqual([]);
    expect(reorder(fs, "c", 1)).toEqual([]);
  });
  it("moveFieldDef writes positions, audits and announces", async () => {
    const m = mk([def({ key: "a", type: "text", position: 0 }), def({ key: "b", type: "text", position: 1 })]);
    expect((await moveFieldDef(m.ctx, "b", -1)).ok).toBe(true);
    expect(m.store.map((f) => [f.key, f.position])).toEqual([["a", 1], ["b", 0]]);
    expect(m.calls).toEqual(["positions", "audit:fields.reordered", "emit"]);
  });
});

describe("helpers", () => {
  it("reconcileChoices reports retired and restored keys", () => {
    const prev = [{ key: "a", label: { en: "A" } }, { key: "b", label: { en: "B" }, archived: true }];
    const r = reconcileChoices(prev, [{ key: "b", label: { en: "B" } }, { key: "c", label: { en: "C" } }]);
    expect(r.restored).toEqual(["b"]);
    expect(r.retired).toEqual(["a"]);
    expect(r.choices.map((c) => c.key)).toEqual(["b", "c", "a"]);
  });
  it("diffField lists only what changed", () => {
    const a = def({ key: "k", type: "text" });
    expect(diffField(a, { ...a, required: true }).map((c) => c.field)).toEqual(["required"]);
  });
});
