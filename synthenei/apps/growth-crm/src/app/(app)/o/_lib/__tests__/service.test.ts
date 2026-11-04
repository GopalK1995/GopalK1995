import { describe, expect, it, vi } from "vitest";
import { def } from "@/lib/metadata/__tests__/fixtures";
import { trFor } from "@/lib/layouts/strings";
import type { AuditActor } from "@/lib/audit/types";
import { createRecordFlow, deleteRecordFlow, renameRecordFlow, type RecordCtx, type RecordDeps } from "../service";
import type { ObjectRecord } from "../types";

const fields = [
  def({ key: "name", type: "text", required: true }),
  def({ key: "qty", type: "number" }),
  def({ key: "status", type: "select", default: "new", options: { choices: [{ key: "new", label: { en: "New" } }, { key: "done", label: { en: "Done" } }] } }),
];
const actor: AuditActor = { uid: "u1", kind: "user", workspaceId: "w1", source: "ui", impersonation: false };
const stored = (p: Partial<ObjectRecord> = {}): ObjectRecord => ({ id: "r1", title: "Old", data: { name: "Old", qty: 1 }, ownerId: null, version: 3, createdAt: "", updatedAt: "", ...p });

function setup(over: Partial<RecordDeps> = {}) {
  const deps: RecordDeps = {
    insert: vi.fn(async (r) => ({ ...stored({ id: "new1", title: r.title, data: r.data, version: 1 }) })),
    get: vi.fn(async () => stored()),
    update: vi.fn(async (_id, v) => ({ version: v + 1 })),
    audit: vi.fn(async () => ({})),
    ...over,
  };
  const ctx: RecordCtx = { ws: "w1", objectKey: "things", objectTypeId: "ot1", fields, primaryKey: "name", actor, ownerId: "u1", locale: "en", t: trFor("en"), deps };
  return { ctx, deps };
}

describe("createRecordFlow", () => {
  it("validates with the field definitions, mirrors the primary field into the title and audits without values", async () => {
    const { ctx, deps } = setup();
    const r = await createRecordFlow(ctx, { name: "  Widget ", qty: "7" });
    expect(r.ok).toBe(true);
    expect(deps.insert).toHaveBeenCalledWith({ workspaceId: "w1", objectTypeId: "ot1", title: "Widget", data: { name: "Widget", qty: 7, status: "new" }, ownerId: "u1" });
    const input = (deps.audit as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(input.action).toBe("records.created");
    expect(JSON.stringify(input)).not.toContain("Widget");
    expect(input.detail.keys).toEqual(expect.arrayContaining(["name", "qty"]));
  });
  it("fails with field issues and writes nothing", async () => {
    const { ctx, deps } = setup();
    const r = await createRecordFlow(ctx, { qty: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe("invalid"); expect(r.issues?.map((i) => i.path).sort()).toEqual(["name", "qty"]); }
    expect(deps.insert).not.toHaveBeenCalled();
    expect(deps.audit).not.toHaveBeenCalled();
  });
  it("a blank primary value is refused", async () => {
    const { ctx } = setup();
    const r = await createRecordFlow(ctx, { name: "   " });
    expect(r.ok).toBe(false);
  });
  it("an audit failure is reported in sub but the record stays created", async () => {
    const { ctx } = setup({ audit: vi.fn(async () => { throw new Error("down"); }) });
    const r = await createRecordFlow({ ...ctx, log: () => {} }, { name: "A" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sub).toMatch(/audit entry could not be written/);
  });
});

describe("renameRecordFlow", () => {
  it("writes title and the primary field under the expected version", async () => {
    const { ctx, deps } = setup();
    const r = await renameRecordFlow(ctx, "r1", 3, " Fresh ");
    expect(r.ok).toBe(true);
    expect(deps.update).toHaveBeenCalledWith("r1", 3, { title: "Fresh", data: { name: "Fresh", qty: 1 } });
    if (r.ok) expect(r.data).toEqual({ version: 4, title: "Fresh" });
    expect((deps.audit as ReturnType<typeof vi.fn>).mock.calls[0][1].action).toBe("records.updated");
  });
  it("a stale version is a conflict carrying only the current version", async () => {
    const { ctx, deps } = setup();
    const r = await renameRecordFlow(ctx, "r1", 2, "X");
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe("conflict"); expect(r.current).toEqual({ version: 3 }); }
    expect(deps.update).not.toHaveBeenCalled();
  });
  it("missing record and empty title", async () => {
    const gone = setup({ get: vi.fn(async () => null) });
    expect((await renameRecordFlow(gone.ctx, "r1", 3, "X"))).toMatchObject({ ok: false, code: "not_found" });
    const { ctx } = setup();
    expect((await renameRecordFlow(ctx, "r1", 3, "  "))).toMatchObject({ ok: false, code: "invalid" });
  });
  it("renaming to the same name changes nothing", async () => {
    const { ctx, deps } = setup();
    const r = await renameRecordFlow(ctx, "r1", 3, "Old");
    expect(r.ok).toBe(true);
    expect(deps.update).not.toHaveBeenCalled();
  });
});

describe("deleteRecordFlow", () => {
  it("soft deletes under the expected version and audits", async () => {
    const { ctx, deps } = setup();
    const r = await deleteRecordFlow(ctx, "r1", 3, new Date("2026-11-04T00:00:00Z"));
    expect(r.ok).toBe(true);
    expect(deps.update).toHaveBeenCalledWith("r1", 3, { deletedAt: "2026-11-04T00:00:00.000Z" });
    expect((deps.audit as ReturnType<typeof vi.fn>).mock.calls[0][1].action).toBe("records.deleted");
  });
  it("conflict and missing", async () => {
    const { ctx } = setup();
    expect(await deleteRecordFlow(ctx, "r1", 1)).toMatchObject({ ok: false, code: "conflict" });
    const gone = setup({ get: vi.fn(async () => null) });
    expect(await deleteRecordFlow(gone.ctx, "r1", 3)).toMatchObject({ ok: false, code: "not_found" });
  });
});
