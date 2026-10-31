import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, systemPrincipal } from "@/lib/authz";
import { def } from "@/lib/metadata/__tests__/fixtures";

const state = { demo: true };
const assertCan = vi.fn();
const principal = systemPrincipal({ uid: "u-owner", workspaceId: "w1", role: "owner" });
vi.mock("@/lib/auth/server", () => ({ requireActive: async () => ({ session: { demo: state.demo, uid: "u-owner" }, active: { ws: { id: "w1", uuid: "w1" }, tenant: {} } }) }));
vi.mock("@/lib/authz/load", () => ({ assertCan: (...a: unknown[]) => assertCan(...a), loadPrincipal: async () => principal }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/vertical", () => ({ vocabFor: () => ({ n: { lead: { one: "enquiry", many: "enquiries" }, deal: { one: "deal", many: "deals" }, firm: { one: "firm", many: "firms" } } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/metadata/meta", () => ({ getObjectMeta: async () => ({ object: { id: "ot1" }, fields: [def({ key: "region", type: "text" }), def({ key: "budget", type: "money", required: true })], demo: state.demo }) }));
const deps = vi.hoisted(() => ({ getRecord: vi.fn(), writeValues: vi.fn() }));
vi.mock("@/lib/metadata/save-db", () => ({ dbSaveDeps: () => deps }));

import { saveCustomFields } from "../actions";

const ok = { objectKey: "lead", recordId: "l1", expectedVersion: 2, patch: { region: "north" } };
beforeEach(() => { state.demo = true; assertCan.mockReset(); assertCan.mockResolvedValue(principal); deps.getRecord.mockReset(); deps.writeValues.mockReset(); });

describe("saveCustomFields", () => {
  it("demo: validates, returns the demo notice, never touches the record store", async () => {
    const r = await saveCustomFields(ok);
    expect(r).toMatchObject({ ok: true, sub: "Demo workspace: nothing was saved." });
    expect(deps.getRecord).not.toHaveBeenCalled();
    expect(deps.writeValues).not.toHaveBeenCalled();
  });
  it("demo: invalid values are still refused", async () => {
    expect(await saveCustomFields({ ...ok, patch: { budget: "lots" } })).toMatchObject({ ok: false, code: "invalid" });
  });
  it("rejects malformed input before any permission or data work", async () => {
    expect(await saveCustomFields({ ...ok, objectKey: "Lead; drop" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await saveCustomFields({ ...ok, patch: { "Bad Key": 1 } })).toMatchObject({ ok: false, code: "invalid" });
    expect(await saveCustomFields({ ...ok, expectedVersion: -1 })).toMatchObject({ ok: false, code: "invalid" });
  });
  it("asks for the write permission of the object", async () => {
    await saveCustomFields(ok);
    expect(assertCan).toHaveBeenCalledWith("leads.write");
  });
  it("denied is returned as a result, not thrown", async () => {
    assertCan.mockRejectedValue(new AuthzError({ allow: false, reason: "no_permission", step: 5, permission: "leads.write", maskedFields: [] }));
    expect(await saveCustomFields(ok)).toMatchObject({ ok: false, code: "denied" });
  });
  it("real: loads the record, writes with the expected version, returns the new version", async () => {
    state.demo = false;
    deps.getRecord.mockResolvedValue({ id: "l1", version: 2, ownerId: "u-owner", assigneeId: null, workspaceId: "w1", values: { budget: 5 } });
    deps.writeValues.mockResolvedValue({ version: 3 });
    const r = await saveCustomFields(ok);
    expect(r).toMatchObject({ ok: true, data: { version: 3, values: { region: "north", budget: 5 } } });
    expect(deps.writeValues).toHaveBeenCalledWith("lead", "l1", 2, { region: "north", budget: 5 });
  });
  it("real: a stale version is a conflict and nothing is written", async () => {
    state.demo = false;
    deps.getRecord.mockResolvedValue({ id: "l1", version: 7, ownerId: "u-owner", assigneeId: null, workspaceId: "w1", values: { budget: 5 } });
    expect(await saveCustomFields(ok)).toMatchObject({ ok: false, code: "conflict", current: { version: 7 } });
    expect(deps.writeValues).not.toHaveBeenCalled();
  });
});
