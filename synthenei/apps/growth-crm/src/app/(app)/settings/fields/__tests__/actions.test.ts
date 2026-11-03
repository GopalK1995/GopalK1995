import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError } from "@/lib/authz";

const state = { demo: true, support: false };
const assertCan = vi.fn();
vi.mock("@/lib/auth/server", () => ({ requireActive: async () => ({ session: { demo: state.demo, uid: "u1" }, active: { ws: { id: "w1", uuid: "00000000-0000-0000-0000-0000000000w1" }, tenant: {}, support: state.support ? { mode: "read_only" } : null } }) }));
vi.mock("@/lib/authz/load", () => ({ assertCan: (...a: unknown[]) => assertCan(...a), loadPrincipal: async () => ({ uid: "u1" }) }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/vertical", () => ({ vocabFor: () => ({ n: { lead: { one: "enquiry", many: "enquiries" }, deal: { one: "booking", many: "bookings" }, firm: { one: "guest", many: "guests" } } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/metadata/meta", () => ({ getObjectMeta: async () => ({ object: { id: "ot1", key: "lead", kind: "system", label: { en: { one: "lead", many: "leads" } } }, fields: [], demo: state.demo }) }));
const repo = vi.hoisted(() => ({
  tenantOfWorkspace: vi.fn(), getFieldByKey: vi.fn(), listFields: vi.fn(), insertField: vi.fn(), updateFieldGuarded: vi.fn(), setPositions: vi.fn(), fieldLimit: vi.fn(), countWithValue: vi.fn(),
}));
vi.mock("@/lib/metadata/repo", () => repo);
const auditFn = vi.fn();
vi.mock("@/lib/audit/record", () => ({ audit: (...a: unknown[]) => auditFn(...a), actorFromPrincipal: () => ({ uid: "u1", kind: "user", workspaceId: "w1", source: "ui", impersonation: false }) }));
vi.mock("@/lib/events/emit", () => ({ emitEvent: vi.fn() }));

import { createField, moveField, restoreField, retireField, updateField } from "../actions";

const body = { objectKey: "lead", key: "deal_size", label: { en: "Deal size" }, type: "money" };

beforeEach(() => {
  state.demo = true; state.support = false;
  assertCan.mockReset(); assertCan.mockResolvedValue({ uid: "u1" });
  for (const f of Object.values(repo)) f.mockReset();
  auditFn.mockReset();
});

describe("demo workspaces never touch the database", () => {
  it("create, update, retire, restore and move validate and return the demo notice without any repository call", async () => {
    const results = [
      await createField(body),
      await updateField({ input: body, rev: "r1" }),
      await retireField({ objectKey: "lead", key: "deal_size", rev: "r1", reason: "Replaced by deal value" }),
      await restoreField({ objectKey: "lead", key: "deal_size", rev: "r1" }),
      await moveField({ objectKey: "lead", key: "deal_size", delta: 1 }),
    ];
    for (const r of results) { expect(r.ok).toBe(true); expect(r.ok && r.sub).toBe("Demo workspace: nothing was saved."); }
    for (const f of Object.values(repo)) expect(f).not.toHaveBeenCalled();
    expect(auditFn).not.toHaveBeenCalled();
  });
  it("still validates input in demo", async () => {
    expect(await createField({ ...body, key: "Bad Key" })).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("authorisation", () => {
  it("every action asks for fields.manage and returns denied with this namespace's wording", async () => {
    assertCan.mockRejectedValue(new AuthzError({ allow: false, reason: "no_permission", step: 5, permission: "fields.manage", maskedFields: [] }));
    for (const r of [await createField(body), await updateField({ input: body, rev: "r" }), await retireField({ objectKey: "lead", key: "deal_size", rev: "r", reason: "long enough reason" }), await restoreField({ objectKey: "lead", key: "deal_size", rev: "r" }), await moveField({ objectKey: "lead", key: "deal_size", delta: 1 })]) {
      expect(r).toMatchObject({ ok: false, code: "denied", message: "You cannot manage custom fields" });
    }
    expect(assertCan).toHaveBeenCalledWith("fields.manage");
    for (const f of Object.values(repo)) expect(f).not.toHaveBeenCalled();
  });
  it("a read-only support session gets the support explanation", async () => {
    state.support = true;
    assertCan.mockRejectedValue(new AuthzError({ allow: false, reason: "support_readonly", step: 4, permission: "fields.manage", maskedFields: [] }));
    expect(await createField(body)).toMatchObject({ ok: false, code: "denied", sub: "Support sessions cannot change custom fields." });
  });
});

describe("real sessions", () => {
  beforeEach(() => {
    state.demo = false;
    repo.tenantOfWorkspace.mockResolvedValue("t1");
    repo.fieldLimit.mockResolvedValue({ max: null, used: 0 });
    repo.getFieldByKey.mockResolvedValue(null);
    repo.listFields.mockResolvedValue([]);
    repo.insertField.mockImplementation(async (_o: string, row: Record<string, unknown>) => ({ id: "f1", objectTypeId: "ot1", key: row.key, label: row.label, type: row.type, options: {}, position: 0, archivedAt: null }));
  });
  it("create writes through the repository and audits", async () => {
    const r = await createField(body);
    expect(r).toMatchObject({ ok: true, message: "Field added: Deal size" });
    expect(repo.insertField).toHaveBeenCalledWith("ot1", expect.objectContaining({ key: "deal_size", type: "money" }), 0);
    expect(auditFn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "fields.created" }));
  });
  it("surfaces a database failure as a generic error without leaking details", async () => {
    repo.insertField.mockRejectedValue(new Error("connection string postgres://secret"));
    const r = await createField(body);
    expect(r).toMatchObject({ ok: false, code: "error", message: "That did not work" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
  it("the limit comes from the organisation policy", async () => {
    repo.fieldLimit.mockResolvedValue({ max: 2, used: 2 });
    expect(await createField(body)).toMatchObject({ ok: false, code: "invalid" });
    expect(repo.insertField).not.toHaveBeenCalled();
  });
  for (const f of Object.values(repo)) f.mockReset();
  auditFn.mockReset();
});

describe("demo workspaces never touch the database", () => {
  it("create, update, retire, restore and move validate and return the demo notice without any repository call", async () => {
    const results = [
      await createField(body),
      await updateField({ input: body, rev: "r1" }),
      await retireField({ objectKey: "lead", key: "deal_size", rev: "r1", reason: "Replaced by deal value" }),
      await restoreField({ objectKey: "lead", key: "deal_size", rev: "r1" }),
      await moveField({ objectKey: "lead", key: "deal_size", delta: 1 }),
    ];
    for (const r of results) { expect(r.ok).toBe(true); expect(r.ok && r.sub).toBe("Demo workspace: nothing was saved."); }
    for (const f of Object.values(repo)) expect(f).not.toHaveBeenCalled();
    expect(auditFn).not.toHaveBeenCalled();
  });
  it("still validates input in demo", async () => {
    expect(await createField({ ...body, key: "Bad Key" })).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("authorisation", () => {
  it("every action asks for fields.manage and returns denied with this namespace's wording", async () => {
    assertCan.mockRejectedValue(new AuthzError({ allow: false, reason: "no_permission", step: 5, permission: "fields.manage", maskedFields: [] }));
    for (const r of [await createField(body), await updateField({ input: body, rev: "r" }), await retireField({ objectKey: "lead", key: "deal_size", rev: "r", reason: "long enough reason" }), await restoreField({ objectKey: "lead", key: "deal_size", rev: "r" }), await moveField({ objectKey: "lead", key: "deal_size", delta: 1 })]) {
      expect(r).toMatchObject({ ok: false, code: "denied", message: "You cannot manage custom fields" });
    }
    expect(assertCan).toHaveBeenCalledWith("fields.manage");
    for (const f of Object.values(repo)) expect(f).not.toHaveBeenCalled();
  });
  it("a read-only support session gets the support explanation", async () => {
    state.support = true;
    assertCan.mockRejectedValue(new AuthzError({ allow: false, reason: "support_readonly", step: 4, permission: "fields.manage", maskedFields: [] }));
    expect(await createField(body)).toMatchObject({ ok: false, code: "denied", sub: "Support sessions cannot change custom fields." });
  });
});

describe("real sessions", () => {
  beforeEach(() => {
    state.demo = false;
    repo.tenantOfWorkspace.mockResolvedValue("t1");
    repo.fieldLimit.mockResolvedValue({ max: null, used: 0 });
    repo.getFieldByKey.mockResolvedValue(null);
    repo.listFields.mockResolvedValue([]);
    repo.insertField.mockImplementation(async (_o: string, row: Record<string, unknown>) => ({ id: "f1", objectTypeId: "ot1", key: row.key, label: row.label, type: row.type, options: {}, position: 0, archivedAt: null }));
  });
  it("create writes through the repository and audits", async () => {
    const r = await createField(body);
    expect(r).toMatchObject({ ok: true, message: "Field added: Deal size" });
    expect(repo.insertField).toHaveBeenCalledWith("ot1", expect.objectContaining({ key: "deal_size", type: "money" }), 0);
    expect(auditFn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "fields.created" }));
  });
  it("surfaces a database failure as a generic error without leaking details", async () => {
    repo.insertField.mockRejectedValue(new Error("connection string postgres://secret"));
    const r = await createField(body);
    expect(r).toMatchObject({ ok: false, code: "error", message: "That did not work" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
  it("the limit comes from the organisation policy", async () => {
    repo.fieldLimit.mockResolvedValue({ max: 2, used: 2 });
    expect(await createField(body)).toMatchObject({ ok: false, code: "invalid" });
    expect(repo.insertField).not.toHaveBeenCalled();
  });
});
