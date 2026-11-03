import { describe, expect, it, vi } from "vitest";
import { systemPrincipal } from "@/lib/authz";
import type { Role } from "@/lib/data/types";
import { DbError } from "@/lib/db/errors";
import { saveCustomValues, writePermOf, type SaveCtx, type SaveDeps, type StoredRecord } from "../save";
import { ft } from "../strings";
import { def } from "./fixtures";

const P = (role: Role, uid = `u-${role}`) => systemPrincipal({ uid, workspaceId: "ws1", role });
const SECRET = "+919812345678";
const defs = [
  def({ key: "region", type: "text" }),
  def({ key: "budget", type: "money", required: true }),
  def({ key: "mobile", type: "phone", isPii: true }),
  def({ key: "discount", type: "percent", options: { access: { editRoles: ["owner"] } } }),
  def({ key: "gstin", type: "text", uniqueInWorkspace: true }),
  def({ key: "legacy", type: "text", archivedAt: "2026-10-01T00:00:00Z" }),
];
const stored = (o: Partial<StoredRecord> = {}): StoredRecord => ({ id: "l1", version: 4, ownerId: "u-sales_rep", assigneeId: null, workspaceId: "ws1", values: { region: "south", budget: 500, mobile: SECRET, legacy: "kept", ...(o.values ?? {}) }, ...o });

const withGrants = (p: ReturnType<typeof P>, f: (g: ReturnType<typeof P>["grants"]) => ReturnType<typeof P>["grants"]) => ({ ...p, grants: f({ ...p.grants }) });

function setup(role: Role, rec: StoredRecord | null = stored(), writeErr?: Error, principal: ReturnType<typeof P> = P(role)) {
  const deps: SaveDeps = {
    getRecord: vi.fn(async () => rec),
    writeValues: vi.fn(async (_o, _id, v) => { if (writeErr) throw writeErr; return { version: v + 1 }; }),
  };
  const ctx: SaveCtx = { principal, ws: "ws1", defs, deps, t: (k, v) => ft(k, { noun: "lead", ...v }) };
  return { ctx, deps };
}
const input = (patch: Record<string, unknown>, expectedVersion = 4) => ({ objectKey: "lead", recordId: "l1", expectedVersion, patch });

describe("saveCustomValues", () => {
  it("saves a changed value with the version the page rendered and returns the new version", async () => {
    const { ctx, deps } = setup("owner");
    const r = await saveCustomValues(ctx, input({ region: "north" }));
    expect(r).toMatchObject({ ok: true, data: { version: 5 } });
    expect(deps.writeValues).toHaveBeenCalledWith("lead", "l1", 4, expect.objectContaining({ region: "north", budget: 500 }));
  });

  it("keeps the values of retired fields in the document it writes (retire keeps data)", async () => {
    const { ctx, deps } = setup("owner");
    await saveCustomValues(ctx, input({ region: "north" }));
    expect((deps.writeValues as ReturnType<typeof vi.fn>).mock.calls[0][3]).toMatchObject({ legacy: "kept" });
  });

  it("a stale version is a conflict that carries only the current version", async () => {
    const { ctx, deps } = setup("owner", stored({ version: 9 }));
    const r = await saveCustomValues(ctx, input({ region: "north" }, 4));
    expect(r).toMatchObject({ ok: false, code: "conflict", current: { version: 9 } });
    expect(JSON.stringify(r)).not.toContain("south");
    expect(deps.writeValues).not.toHaveBeenCalled();
  });

  it("a write that loses the race maps to the same conflict", async () => {
    const { ctx } = setup("owner", stored(), new DbError("conflict", "conflict", { current: { version: 7, custom: { mobile: SECRET } } }));
    const r = await saveCustomValues(ctx, input({ region: "north" }));
    expect(r).toMatchObject({ ok: false, code: "conflict", current: { version: 7 } });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("denied: a role without write on the record cannot save", async () => {
    const { ctx, deps } = setup("viewer");
    expect(await saveCustomValues(ctx, input({ region: "x" }))).toMatchObject({ ok: false, code: "denied" });
    expect(deps.writeValues).not.toHaveBeenCalled();
  });

  it("denied: role-based edit permission per field (editRoles)", async () => {
    const mgr = setup("sales_manager", stored({ ownerId: "u-sales_manager" }));
    expect(await saveCustomValues(mgr.ctx, input({ discount: 10 }))).toMatchObject({ ok: false, code: "denied", issues: [{ path: "discount" }] });
    expect(mgr.deps.writeValues).not.toHaveBeenCalled();
    const owner = setup("owner");
    expect((await saveCustomValues(owner.ctx, input({ discount: 10 }))).ok).toBe(true);
  });

  it("denied: unknown keys and retired fields get the same answer as hidden ones", async () => {
    const { ctx } = setup("owner");
    for (const k of ["nope", "legacy"]) expect(await saveCustomValues(ctx, input({ [k]: "x" }))).toMatchObject({ ok: false, code: "denied" });
  });

  it("not found when the record is gone", async () => {
    const { ctx } = setup("owner", null);
    expect(await saveCustomValues(ctx, input({ region: "x" }))).toMatchObject({ ok: false, code: "not_found" });
  });

  it("invalid: friendly messages by field, nothing written", async () => {
    const { ctx, deps } = setup("owner");
    const r = await saveCustomValues(ctx, input({ budget: "lots" }));
    expect(r).toMatchObject({ ok: false, code: "invalid", issues: [{ path: "budget", message: "budget must be a number" }] });
    expect(deps.writeValues).not.toHaveBeenCalled();
  });

  it("required: clearing a required value is refused", async () => {
    const { ctx } = setup("owner");
    expect(await saveCustomValues(ctx, input({ budget: "" }))).toMatchObject({ ok: false, code: "invalid", issues: [{ path: "budget" }] });
  });

  it("a cleared optional value is removed from the document", async () => {
    const { ctx, deps } = setup("owner");
    await saveCustomValues(ctx, input({ region: "" }));
    expect((deps.writeValues as ReturnType<typeof vi.fn>).mock.calls[0][3]).not.toHaveProperty("region");
  });

  it("unique: the DB error becomes a field message, not a crash", async () => {
    const { ctx } = setup("owner", stored(), new DbError("unique", "unique", { detail: 'custom field "gstin" must be unique in the workspace' }));
    const r = await saveCustomValues(ctx, input({ gstin: "29ABCDE1234F1Z5" }));
    expect(r).toMatchObject({ ok: false, code: "invalid", issues: [{ path: "gstin" }] });
  });

  it("the returned values are masked for the caller: PII the caller cannot see is not echoed", async () => {
    const noPii = withGrants(P("sales_rep"), (g) => { delete g["pii.read"]; return g; });
    const { ctx } = setup("sales_rep", stored(), undefined, noPii);
    const r = await saveCustomValues(ctx, input({ region: "north" }));
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("own scope: a rep cannot save on a lead owned by someone else", async () => {
    const own = withGrants(P("sales_rep"), (g) => ({ ...g, "leads.write": { scope: "own" } }));
    const { ctx } = setup("sales_rep", stored({ ownerId: "someone-else" }), undefined, own);
    expect(await saveCustomValues(ctx, input({ region: "x" }))).toMatchObject({ ok: false, code: "denied" });
  });

  it("write permission per object", () => {
    expect(writePermOf("lead")).toBe("leads.write");
    expect(writePermOf("deal")).toBe("deals.write");
    expect(writePermOf("site_visit")).toBe("obj:site_visit.write");
  });
});
