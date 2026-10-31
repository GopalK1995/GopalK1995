import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError } from "@/lib/authz";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ requireActive: vi.fn() }));
vi.mock("@/lib/audit/record", () => ({ audit: vi.fn(), actorFromPrincipal: vi.fn(() => ({})) }));
vi.mock("@/lib/jobs/registry", () => ({ enqueue: vi.fn() }));
const requestRuntime = vi.fn();
vi.mock("@/lib/connectors/core/runtime", () => ({ requestRuntime: (...a: unknown[]) => requestRuntime(...a), runtimeFromDb: vi.fn(), vendorEnv: () => ({}) }));
const manageCtx = vi.fn();
vi.mock("../../_lib/ctx", () => ({ manageCtx: () => manageCtx(), viewCtx: vi.fn() }));
vi.mock("../../_lib/strings", async () => {
  const real = await vi.importActual<typeof import("../../_lib/strings")>("../../_lib/strings");
  return { ...real, getIntT: async () => real.makeT("en") };
});

import { connectConnector, disconnectConnector, previewFieldMap, runSyncConnector, saveFieldMap, testConnector } from "../actions";

const denied = (reason: "support_blocked" | "no_permission") => new AuthzError({ allow: false, reason, step: 4, permission: "integrations.manage", maskedFields: [] });
beforeEach(() => { manageCtx.mockReset(); requestRuntime.mockReset(); });

describe("integration actions", () => {
  it("every real action asserts the permission first: support blocked and non-owner are denied before any runtime is built", async () => {
    for (const reason of ["support_blocked", "no_permission"] as const) {
      manageCtx.mockRejectedValue(denied(reason));
      const rs = await Promise.all([
        connectConnector("mock", { api_key: "x" }), testConnector("c1"), disconnectConnector("c1"), runSyncConnector("c1"),
        saveFieldMap({ connectionId: "c1", rows: [] }), previewFieldMap({ connectorId: "mock", rows: [], sample: "{}" }),
      ]);
      for (const r of rs) expect(r).toMatchObject({ ok: false, code: "denied" });
    }
    expect(requestRuntime).not.toHaveBeenCalled();
  });
  it("demo sessions get the not-saved result and never build a runtime", async () => {
    manageCtx.mockResolvedValue({ demo: true, uid: "u", ws: "w", tenant: "t", role: "owner", principal: {}, support: false, db: null });
    const rs = await Promise.all([connectConnector("mock", { api_key: "x" }), testConnector("c1"), disconnectConnector("c1"), runSyncConnector("c1"), saveFieldMap({ connectionId: "c1", rows: [] })]);
    for (const r of rs) expect(r).toMatchObject({ ok: true, message: "Demo workspace: nothing was saved." });
    expect(requestRuntime).not.toHaveBeenCalled();
  });
  it("rejects malformed input before checking anything else", async () => {
    expect(await connectConnector("Bad Id!", {})).toMatchObject({ ok: false, code: "invalid" });
    expect(await testConnector("")).toMatchObject({ ok: false, code: "invalid" });
    expect(manageCtx).not.toHaveBeenCalled();
  });
  it("preview applies an unsaved map to a sample and reports invalid JSON", async () => {
    manageCtx.mockResolvedValue({ demo: false });
    const row = { externalObject: "Contact", externalField: "phone", localTable: "leads", localColumn: "phone", direction: "in" as const, transform: "e164_phone", transformArg: "" };
    const ok = await previewFieldMap({ connectorId: "mock", rows: [row], sample: JSON.stringify({ phone: "98450 12345" }) });
    expect(ok).toMatchObject({ ok: true, data: { mapped: { leads: { phone: "+919845012345" } }, rejected: [] } });
    expect(await previewFieldMap({ connectorId: "mock", rows: [row], sample: "{nope" })).toMatchObject({ ok: false, code: "invalid" });
  });
  it("a real connect passes credentials to the framework and never returns them", async () => {
    manageCtx.mockResolvedValue({ demo: false, uid: "u", ws: "w", tenant: "t", role: "owner", principal: {}, support: false, db: {} });
    const insert = vi.fn();
    const row = { id: "c1", tenantId: "t", workspaceId: "w", connectorId: "mock", mode: "sandbox", status: "not_configured", settings: {}, credentialSecretId: null, webhookSecretId: null, tokenExpiresAt: null };
    requestRuntime.mockResolvedValue({
      store: { getAvailability: async () => ({ mode: "sandbox", gateStatus: "ready" }), findConnection: async () => null, insertConnection: async (n: unknown) => { insert(n); return row; }, updateConnection: async () => undefined },
      vault: { putSecret: async () => "sec-1", getSecret: async () => null, deleteSecret: async () => undefined }, env: {}, log: { info() {}, warn() {}, error() {} },
    });
    const r = await connectConnector("mock", { api_key: "mock-key-ok" });
    expect(r).toMatchObject({ ok: true, message: "Mock connector connected in sandbox" });
    expect(JSON.stringify([r, insert.mock.calls])).not.toContain("mock-key-ok");
    const bad = await connectConnector("mock", { api_key: "wrong-key" });
    expect(bad).toMatchObject({ ok: false, code: "invalid", message: "The vendor rejected these credentials." });
    expect(JSON.stringify(bad)).not.toContain("wrong-key");
  });
});
