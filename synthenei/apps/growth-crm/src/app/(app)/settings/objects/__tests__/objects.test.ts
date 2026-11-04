import { describe, expect, it, vi } from "vitest";
import { trFor } from "@/lib/layouts/strings";
import type { AuditActor } from "@/lib/audit/types";
import { deriveObjectKey, isReservedKey, labelJson, objectInputSchema, objectUpdateSchema } from "../_lib/schema";
import { createObjectFlow, updateObjectFlow, type ObjectAdminCtx, type ObjectDeps } from "../_lib/service";
import type { AdminObject } from "../_lib/repo";

const actor: AuditActor = { uid: "u1", kind: "user", workspaceId: "w1", source: "ui", impersonation: false };
const obj = (p: Partial<AdminObject> = {}): AdminObject => ({
  id: "ot1", key: "site_visit", kind: "custom", label: { en: { one: "Site visit", many: "Site visits" } }, icon: "box", primaryField: "name", isEnabled: true, schemaVersion: 1, rev: "r1", position: 1, ...p,
});

function setup(over: Partial<ObjectDeps> = {}) {
  const deps: ObjectDeps = {
    allowed: vi.fn(async () => true),
    list: vi.fn(async () => [obj({ key: "other", position: 4 })]),
    getByKey: vi.fn(async () => null),
    insert: vi.fn(async (_t, r) => obj({ key: r.key, position: r.position, primaryField: r.primaryField, icon: r.icon })),
    insertPrimaryField: vi.fn(async () => ({})),
    updateGuarded: vi.fn(async (_id, _rev, patch) => obj({ rev: "r2", isEnabled: patch.is_enabled as boolean, icon: patch.icon as string })),
    audit: vi.fn(async () => ({})),
    emit: vi.fn(async () => ({})),
    ...over,
  };
  const ctx: ObjectAdminCtx = { ws: "w1", tenantId: "t1", actor, t: trFor("en"), deps };
  return { ctx, deps };
}
const input = objectInputSchema.parse({ one: { en: "Site visit", ta: "" }, many: { en: "Site visits" }, primary: { en: "Name" }, icon: "building" });

describe("keys", () => {
  it("derives a legal key from the English singular label", () => {
    expect(deriveObjectKey("Site visit")).toBe("site_visit");
    expect(deriveObjectKey("  Order #7 ")).toBe("order_7");
    expect(deriveObjectKey("123")).toMatch(/^[a-z][a-z0-9_]{1,40}$/);
    expect(deriveObjectKey("x".repeat(80)).length).toBeLessThanOrEqual(41);
  });
  it("system object words are reserved and never produced as a key", () => {
    expect(isReservedKey("lead")).toBe(true);
    expect(isReservedKey("fields")).toBe(true);
    expect(deriveObjectKey("Deal")).toBe("x_deal");
    expect(isReservedKey(deriveObjectKey("Deal"))).toBe(false);
  });
});

describe("input schemas", () => {
  it("require English names, a known icon and a legal key", () => {
    expect(objectInputSchema.safeParse({ ...input, one: { en: "" } }).success).toBe(false);
    expect(objectInputSchema.safeParse({ ...input, icon: "<script>" }).success).toBe(false);
    expect(objectInputSchema.safeParse({ ...input, key: "Bad Key" }).success).toBe(false);
    expect(objectInputSchema.safeParse(input).success).toBe(true);
  });
  it("update needs the revision token", () => {
    expect(objectUpdateSchema.safeParse({ key: "k1", one: { en: "A" }, many: { en: "As" }, icon: "box", enabled: true }).success).toBe(false);
  });
  it("labels: Tamil is stored only when given; plural falls back to singular", () => {
    expect(labelJson({ one: { en: " A " }, many: { en: "As" } })).toEqual({ en: { one: "A", many: "As" } });
    expect(labelJson({ one: { en: "A", ta: "அ" }, many: { en: "As", ta: "" } })).toEqual({ en: { one: "A", many: "As" }, ta: { one: "அ", many: "அ" } });
  });
});

describe("createObjectFlow", () => {
  it("inserts the object, its required primary text field, audits and announces; no role is named", async () => {
    const { ctx, deps } = setup();
    const r = await createObjectFlow(ctx, input);
    expect(r.ok).toBe(true);
    const ins = (deps.insert as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ins[1]).toMatchObject({ key: "site_visit", icon: "building", primaryField: "name", position: 5 });
    const field = (deps.insertPrimaryField as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(field[0]).toBe("ot1");
    expect(field[1]).toMatchObject({ key: "name", type: "text", required: true, is_searchable: true, position: 0 });
    expect((deps.audit as ReturnType<typeof vi.fn>).mock.calls[0][1].action).toBe("objects.created");
    expect((deps.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ type: "metadata.changed", objectType: "object_type" });
  });
  it("refuses when the organisation policy switched custom objects off", async () => {
    const { ctx, deps } = setup({ allowed: vi.fn(async () => false) });
    expect(await createObjectFlow(ctx, input)).toMatchObject({ ok: false, code: "denied" });
    expect(deps.insert).not.toHaveBeenCalled();
  });
  it("refuses a reserved or taken key without writing", async () => {
    const a = setup();
    expect(await createObjectFlow(a.ctx, { ...input, key: "lead" })).toMatchObject({ ok: false, code: "invalid" });
    const b = setup({ getByKey: vi.fn(async () => obj()) });
    const r = await createObjectFlow(b.ctx, input);
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(b.deps.insert).not.toHaveBeenCalled();
  });
  it("if the primary field cannot be added the object stays and the message says so", async () => {
    const { ctx, deps } = setup({ insertPrimaryField: vi.fn(async () => { throw new Error("rls"); }) });
    const r = await createObjectFlow({ ...ctx, log: () => {} }, input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sub).toMatch(/main field/);
    expect(deps.audit).not.toHaveBeenCalled();
  });
  it("audit failure is reported, not hidden", async () => {
    const { ctx } = setup({ audit: vi.fn(async () => { throw new Error("x"); }) });
    const r = await createObjectFlow({ ...ctx, log: () => {} }, input);
    expect(r.ok && r.sub).toMatch(/audit entry/);
  });
});

describe("updateObjectFlow", () => {
  const upd = { key: "site_visit", rev: "r1", one: { en: "Site visit" }, many: { en: "Site visits" }, icon: "box", enabled: true };
  it("disabling writes is_enabled under the revision and audits objects.disabled", async () => {
    const { ctx, deps } = setup({ getByKey: vi.fn(async () => obj()) });
    const r = await updateObjectFlow(ctx, { ...upd, enabled: false });
    expect(r.ok).toBe(true);
    expect((deps.updateGuarded as ReturnType<typeof vi.fn>).mock.calls[0].slice(0, 2)).toEqual(["ot1", "r1"]);
    expect((deps.audit as ReturnType<typeof vi.fn>).mock.calls[0][1].action).toBe("objects.disabled");
    if (r.ok) expect(r.message).toMatch(/records are kept/);
  });
  it("a stale revision is a conflict and nothing is written", async () => {
    const { ctx, deps } = setup({ getByKey: vi.fn(async () => obj({ rev: "newer" })) });
    expect(await updateObjectFlow(ctx, upd)).toMatchObject({ ok: false, code: "conflict", current: { rev: "newer" } });
    expect(deps.updateGuarded).not.toHaveBeenCalled();
  });
  it("no change and missing object", async () => {
    const same = setup({ getByKey: vi.fn(async () => obj()) });
    expect((await updateObjectFlow(same.ctx, upd)).ok).toBe(true);
    expect(same.deps.updateGuarded).not.toHaveBeenCalled();
    const gone = setup();
    expect(await updateObjectFlow(gone.ctx, upd)).toMatchObject({ ok: false, code: "not_found" });
    const sys = setup({ getByKey: vi.fn(async () => obj({ kind: "system" })) });
    expect(await updateObjectFlow(sys.ctx, upd)).toMatchObject({ ok: false, code: "not_found" });
  });
});
