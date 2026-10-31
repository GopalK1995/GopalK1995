import { beforeEach, describe, expect, it, vi } from "vitest";
import { systemPrincipal } from "@/lib/authz/principal";
import { AuthzError } from "@/lib/authz/engine";

const h = vi.hoisted(() => ({
  principal: null as unknown, demo: false, rpcError: null as { code?: string } | null, rpcCalls: [] as { fn: string; args: Record<string, unknown> }[], fromCalls: 0,
  platformRole: "super_admin", rows: [] as Record<string, unknown>[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Map([["x-request-id", "req-9"], ["user-agent", "UA"]]) }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/auth/server", () => ({ requireActive: async () => ({ session: { demo: h.demo, uid: "u1" }, active: {} }) }));
vi.mock("@/lib/authz/load", () => ({
  assertCan: async (perm: string) => {
    const p = h.principal as ReturnType<typeof systemPrincipal>;
    if (!p.grants[perm]) throw new AuthzError({ allow: false, reason: "no_permission", step: 5, permission: perm, maskedFields: [] });
    return p;
  },
}));
vi.mock("@/app/admin/_lib/platform-session", () => ({
  assertPlatform: async (perm: string) => {
    if (h.platformRole !== "super_admin" && perm === "platform.tenants.manage") throw new AuthzError({ allow: false, reason: "no_permission", step: 5, permission: perm, maskedFields: [] });
    return { session: { demo: h.demo, uid: "admin1" }, role: h.platformRole };
  },
}));
vi.mock("@/lib/db/client", () => {
  const qb = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "ilike", "gte", "lt", "or", "order", "limit"]) p[m] = () => p;
    p.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: h.rows, error: null }).then(res);
    return p;
  };
  return { dbForRequest: async () => ({ from: () => { h.fromCalls++; return qb(); }, rpc: (fn: string, args: Record<string, unknown>) => { h.rpcCalls.push({ fn, args }); return Promise.resolve({ data: 7, error: h.rpcError }); } }) };
});

import { exportOrgAudit, exportPlatformAudit } from "../actions";

const principal = (support: { mode: "read_only" | "read_write" } | null, perms: string[]) => {
  const p = systemPrincipal({ uid: "u1", workspaceId: "ws-uuid", role: "owner", tenantId: "t", modulesOff: [], tenant: { status: "active" }, support });
  p.grants = Object.fromEntries(perms.map((k) => [k, { scope: "all" as const }]));
  return p;
};
const row = { id: 5, occurred_at: "2026-10-12T10:00:00Z", table_name: "leads", action: "update", actor_label: "Meena", ip: "1.2.3.4", summary: "update lead a@b.in" };

beforeEach(() => { h.demo = false; h.rpcError = null; h.rpcCalls = []; h.fromCalls = 0; h.rows = [row]; h.platformRole = "super_admin"; h.principal = principal(null, ["audit.read"]); });

describe("exportOrgAudit", () => {
  it("is denied without audit.read and touches nothing", async () => {
    h.principal = principal(null, []);
    const r = await exportOrgAudit({});
    expect(r.ok).toBe(false);
    expect(h.fromCalls + h.rpcCalls.length).toBe(0);
  });
  it("is blocked inside a support session: no read, no audit write", async () => {
    h.principal = principal({ mode: "read_write" }, ["audit.read"]);
    const r = await exportOrgAudit({});
    expect(r).toMatchObject({ ok: false, code: "denied" });
    expect(h.fromCalls + h.rpcCalls.length).toBe(0);
  });
  it("records its own audit row, masks PII, and returns the csv", async () => {
    const r = await exportOrgAudit({ action: "update" });
    expect(r.ok).toBe(true);
    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0].fn).toBe("audit_record");
    expect(h.rpcCalls[0].args).toMatchObject({ p_action: "audit.exported", p_workspace: "ws-uuid", p_request_id: "req-9", p_impersonation: false });
    const csv = r.ok ? r.data!.csv : "";
    expect(csv).toContain("update lead [email]");
    expect(csv).not.toContain("1.2.3.4");
    expect(csv).not.toContain("a@b.in");
  });
  it("with pii.read the ip is kept", async () => {
    h.principal = principal(null, ["audit.read", "pii.read"]);
    const r = await exportOrgAudit({});
    expect(r.ok && r.data!.csv).toContain("1.2.3.4");
  });
  it("is cancelled when the audit row cannot be written: no data comes back", async () => {
    h.rpcError = { code: "42501" };
    const r = await exportOrgAudit({});
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty("data");
  });
  it("demo exports nothing and never touches Supabase", async () => {
    h.demo = true;
    const r = await exportOrgAudit({});
    expect(r.ok).toBe(true);
    expect(r.ok && r.data).toBeUndefined();
    expect(h.fromCalls + h.rpcCalls.length).toBe(0);
  });
});

describe("exportPlatformAudit", () => {
  it("is denied for non super admins", async () => {
    h.platformRole = "support";
    const r = await exportPlatformAudit({});
    expect(r).toMatchObject({ ok: false, code: "denied" });
    expect(h.fromCalls + h.rpcCalls.length).toBe(0);
  });
  it("audits the export with no workspace and masks all PII", async () => {
    const r = await exportPlatformAudit({});
    expect(r.ok).toBe(true);
    expect(h.rpcCalls[0].args).toMatchObject({ p_action: "audit.exported", p_workspace: null, p_actor_kind: "platform_admin" });
    expect(r.ok && r.data!.csv).not.toContain("1.2.3.4");
  });
});
