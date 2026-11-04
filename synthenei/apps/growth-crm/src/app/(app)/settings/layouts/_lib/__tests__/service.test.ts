import { describe, expect, it, vi } from "vitest";
import { def } from "@/lib/metadata/__tests__/fixtures";
import { trFor } from "@/lib/layouts/strings";
import type { AuditActor } from "@/lib/audit/types";
import type { LayoutRow } from "@/lib/layouts/resolve";
import { deleteLayoutFlow, saveLayoutFlow, targetOf, type LayoutCtx, type LayoutDeps } from "../service";

const actor: AuditActor = { uid: "u1", kind: "user", workspaceId: "w1", source: "ui", impersonation: false };
const fields = [def({ key: "name", type: "text" }), def({ key: "status", type: "select" }), def({ key: "qty", type: "number" })];
const saved = (p: Partial<LayoutRow> = {}): LayoutRow => ({ id: "L1", objectTypeId: "ot1", kind: "detail", workspaceId: null, roleId: null, spec: {}, version: 2, ...p });

function setup(over: Partial<LayoutDeps> = {}) {
  const deps: LayoutDeps = {
    roles: vi.fn(async () => [{ id: "role1", key: "r", name: "R", system: false }]),
    save: vi.fn(async () => saved()),
    remove: vi.fn(async () => "L1"),
    audit: vi.fn(async () => ({})),
    emit: vi.fn(async () => ({})),
    ...over,
  };
  const ctx: LayoutCtx = { ws: "w1", tenantId: "t1", uid: "u1", actor, t: trFor("en"), deps, objectKey: "things", objectTypeId: "ot1", fields, primaryKey: "name" };
  return { ctx, deps };
}
const good = { sections: [{ id: "s1", title: "Main", fields: ["status"] }], showRelated: true, showComments: true };

describe("targets", () => {
  it("workspace scope uses the workspace id, org scope none; the role is carried through", () => {
    expect(targetOf({ ws: "w1", objectTypeId: "ot1" }, { kind: "list", scope: "workspace", roleId: "r" })).toEqual({ objectTypeId: "ot1", kind: "list", workspaceId: "w1", roleId: "r" });
    expect(targetOf({ ws: "w1", objectTypeId: "ot1" }, { kind: "detail", scope: "org", roleId: null }).workspaceId).toBeNull();
  });
});

describe("saveLayoutFlow", () => {
  it("validates, saves under the loaded version, audits and announces", async () => {
    const { ctx, deps } = setup();
    const r = await saveLayoutFlow(ctx, { kind: "detail", scope: "org", roleId: "role1", spec: good, version: 2 });
    expect(r).toMatchObject({ ok: true, data: { version: 2 } });
    expect(deps.save).toHaveBeenCalledWith({ objectTypeId: "ot1", kind: "detail", workspaceId: null, roleId: "role1" }, good, 2, "u1");
    expect((deps.audit as ReturnType<typeof vi.fn>).mock.calls[0][1].action).toBe("layouts.saved");
    expect((deps.emit as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ type: "metadata.changed", objectType: "layout" });
  });
  it("an invalid spec is refused with the issues and nothing is written", async () => {
    const { ctx, deps } = setup();
    const r = await saveLayoutFlow(ctx, { kind: "detail", scope: "org", roleId: null, spec: { sections: [{ title: "", fields: ["ghost"] }] }, version: 0 });
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    if (!r.ok) expect(r.issues?.length).toBe(2);
    expect(deps.save).not.toHaveBeenCalled();
  });
  it("a role that is not the tenant's is refused", async () => {
    const { ctx, deps } = setup();
    const r = await saveLayoutFlow(ctx, { kind: "detail", scope: "org", roleId: "other-tenant-role", spec: good, version: 0 });
    expect(r).toMatchObject({ ok: false, code: "invalid" });
    expect(deps.save).not.toHaveBeenCalled();
  });
  it("conflicts thrown by the repository propagate for the action to map", async () => {
    const { DbError } = await import("@/lib/db/errors");
    const { ctx } = setup({ save: vi.fn(async () => { throw new DbError("conflict", "conflict", { current: { version: 9 } }); }) });
    await expect(saveLayoutFlow(ctx, { kind: "list", scope: "workspace", roleId: null, spec: { columns: ["title"] }, version: 1 })).rejects.toMatchObject({ code: "conflict" });
  });
  it("audit failure is reported", async () => {
    const { ctx } = setup({ audit: vi.fn(async () => { throw new Error("x"); }) });
    const r = await saveLayoutFlow({ ...ctx, log: () => {} }, { kind: "list", scope: "org", roleId: null, spec: { columns: ["title", "custom.qty"] }, version: 0 });
    expect(r.ok && r.sub).toMatch(/audit entry/);
  });
});

describe("deleteLayoutFlow", () => {
  it("removes the override and audits with the layout id", async () => {
    const { ctx, deps } = setup();
    const r = await deleteLayoutFlow(ctx, { kind: "detail", scope: "workspace", roleId: null, version: 2 });
    expect(r.ok).toBe(true);
    expect(deps.remove).toHaveBeenCalledWith({ objectTypeId: "ot1", kind: "detail", workspaceId: "w1", roleId: null }, 2);
    expect((deps.audit as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ action: "layouts.deleted", object: { table: "layouts", id: "L1" } });
  });
});
