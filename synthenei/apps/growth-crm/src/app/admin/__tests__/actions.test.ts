import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError } from "@/lib/authz/engine";

const state = vi.hoisted(() => ({
  demo: false,
  role: "super_admin",
  asserted: [] as string[],
  calls: [] as { fn: string; args: Record<string, unknown> | undefined }[],
  rows: {} as Record<string, unknown>,
  redirects: [] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), get: () => undefined, delete: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { state.redirects.push(u); throw new Error(`NEXT_REDIRECT ${u}`); } }));
vi.mock("@/lib/auth/actions", () => ({ startSupport: vi.fn(async () => undefined) }));
vi.mock("@/lib/db/client", () => ({
  dbForRequest: async () => ({
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      state.calls.push({ fn, args });
      if (fn === "admin_workspace_stats") return { data: [{ tenant_id: "t1", tenant_name: "Acme", workspace_id: "11111111-1111-1111-1111-111111111111", workspace_name: "Main" }], error: null };
      if (fn === "admin_create_tenant") return { data: { tenant_id: "t9", workspace_id: "w9" }, error: null };
      if (fn === "start_support_session") return { data: "s1", error: null };
      return { data: null, error: null };
    },
    from: (table: string) => {
      const p: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "update"]) p[m] = () => p;
      p.maybeSingle = async () => ({ data: state.rows[table] ?? null, error: null });
      p.upsert = async (v: unknown) => { state.calls.push({ fn: `upsert:${table}`, args: v as Record<string, unknown> }); return { error: null }; };
      p.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: table === "connector_catalog" ? [{ id: "csv", name: "CSV", category: "data", gate: "none" }] : [], error: null }).then(res);
      return p;
    },
  }),
}));
vi.mock("../_lib/platform-session", () => ({
  assertPlatform: async (perm: string) => {
    state.asserted.push(perm);
    const { PLATFORM_ROLE_PERMS } = await import("../_lib/platform-authz");
    if (!(PLATFORM_ROLE_PERMS as Record<string, string[]>)[state.role].includes(perm)) {
      const { decide } = await import("@/lib/authz/engine");
      const { platformPrincipal } = await import("../_lib/platform-authz");
      throw new AuthzError(decide(platformPrincipal("u1", state.role as never), perm));
    }
    return { session: { uid: "u1", name: "Vikram Anand", email: "v@synthan.example", demo: state.demo, platformAdmin: true, memberships: [], iat: 0 }, role: state.role };
  },
}));

import * as actions from "../_components/actions";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const TENANT_UUID = "t1";
beforeEach(() => {
  state.demo = false; state.role = "super_admin"; state.asserted = []; state.calls = []; state.redirects = [];
  state.rows = { tenants: { id: TENANT_UUID, slug: "acme", name: "Acme", brand_name: "Acme", status: "active", plan: "growth" }, org_admin_policies: null };
});

describe("every mutating admin action calls assertCan with a platform.* permission", () => {
  const forms: [keyof typeof actions, () => unknown[], string][] = [
    ["createTenant", () => [fd({})], "platform.tenants.manage"],
    ["createWorkspace", () => [fd({})], "platform.tenants.manage"],
    ["inviteOwner", () => [fd({})], "platform.tenants.manage"],
    ["setTenantStatus", () => [fd({})], "platform.tenants.manage"],
    ["saveBranding", () => [fd({})], "platform.tenants.manage"],
    ["saveOrgAdminPolicy", () => ["acme", {}, "a reason"], "platform.policies.manage"],
    ["saveConnectorCell", () => [fd({})], "platform.policies.manage"],
    ["userAction", () => [fd({})], "platform.tenants.manage"],
    ["grantPlatformAdmin", () => [fd({})], "platform.tenants.manage"],
    ["revokePlatformAdmin", () => [fd({})], "platform.tenants.manage"],
    ["exportAudit", () => [], "platform.read"],
  ];
  it.each(forms)("%s asserts %s before doing anything", async (name, args, perm) => {
    state.demo = true;
    await (actions[name] as (...a: unknown[]) => Promise<unknown>)(...args());
    expect(state.asserted[0]).toBe(perm);
    expect(state.calls).toEqual([]);
  });
  it("startSupportSession asserts platform.support", async () => {
    state.demo = true;
    await actions.startSupportSession(fd({ ws: "lawsome-tn" }));
    expect(state.asserted).toEqual(["platform.support"]);
  });
  it("source guard: every exported action in actions.ts and config-actions.ts goes through guard()/assertPlatform()", () => {
    const files = [join(__dirname, "../_components/actions.ts"), join(__dirname, "../(console)/tenants/[id]/_components/config-actions.ts")];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const parts = src.split(/^export async function /m).slice(1);
      expect(parts.length).toBeGreaterThan(3);
      for (const body of parts) {
        const name = body.slice(0, body.indexOf("("));
        expect(/guard\("platform\.|assertPlatform\("platform\.|actor\(\)/.test(body), `${name} has no platform.* check`).toBe(true);
      }
    }
  });
});

describe("denied platform roles reach nothing", () => {
  it.each([
    ["support", "saveOrgAdminPolicy"], ["support", "setTenantStatus"], ["support", "createTenant"], ["support", "saveConnectorCell"],
    ["billing", "saveOrgAdminPolicy"], ["billing", "exportAudit"], ["readonly", "createTenant"], ["readonly", "startSupportSession"],
  ] as const)("role %s cannot run %s", async (role, name) => {
    state.role = role;
    const args = name === "saveOrgAdminPolicy" ? ["acme", { allow_api_keys: false }, "valid reason"] : name === "exportAudit" ? [] : [fd({ tenant: "acme", confirm: "acme", name: "x", slug: "acme" })];
    if (name === "startSupportSession") {
      await expect(actions.startSupportSession(fd({ ws: "w" }))).rejects.toThrow(/NEXT_REDIRECT .*error=role/);
    } else {
      const r = (await (actions[name] as (...a: unknown[]) => Promise<{ ok: boolean }>)(...args));
      expect(r.ok).toBe(false);
    }
    expect(state.calls).toEqual([]);
  });
  it("a caller who is not a platform admin never gets past the session gate", async () => {
    vi.resetModules();
    vi.doUnmock("../_lib/platform-session");
    vi.doMock("@/lib/auth/server", () => ({ requirePlatformAdmin: async () => { throw new Error("NEXT_REDIRECT /forbidden?page=/admin"); } }));
    const mod = await import("../_lib/platform-session");
    await expect(mod.assertPlatform("platform.read")).rejects.toThrow(/NEXT_REDIRECT \/forbidden/);
    vi.doUnmock("@/lib/auth/server");
  });
});

describe("real mode", () => {
  it("saves the org-admin policy as a diff with the reason through admin_set_org_admin_policy", async () => {
    const r = await actions.saveOrgAdminPolicy("acme", { allow_api_keys: false, allow_webhooks: true, max_seats: 20 }, "Pilot contract excludes API keys");
    expect(r.ok).toBe(true);
    const c = state.calls.find((x) => x.fn === "admin_set_org_admin_policy");
    expect(c?.args).toEqual({ p_tenant: TENANT_UUID, p_policy: { allow_api_keys: false, max_seats: 20 }, p_reason: "Pilot contract excludes API keys" });
  });
  it("refuses a short reason, an unknown key and a no-op without calling the RPC", async () => {
    expect((await actions.saveOrgAdminPolicy("acme", { allow_api_keys: false }, "short")).ok).toBe(false);
    expect((await actions.saveOrgAdminPolicy("acme", { tenant_id: "x" }, "a long enough reason")).ok).toBe(false);
    expect((await actions.saveOrgAdminPolicy("acme", { allow_webhooks: true }, "a long enough reason")).message).toMatch(/Nothing changed/);
    expect(state.calls.some((x) => x.fn === "admin_set_org_admin_policy")).toBe(false);
  });
  it("suspends and reactivates through admin_set_tenant_status, after the typed confirmation", async () => {
    expect((await actions.setTenantStatus(fd({ tenant: "acme", to: "suspended", confirm: "nope" }))).ok).toBe(false);
    expect((await actions.setTenantStatus(fd({ tenant: "acme", to: "suspended", confirm: "acme" }))).ok).toBe(true);
    expect((await actions.setTenantStatus(fd({ tenant: "acme", to: "active", confirm: "acme" }))).ok).toBe(true);
    expect(state.calls.filter((x) => x.fn === "admin_set_tenant_status").map((x) => x.args)).toEqual([{ p_tenant: TENANT_UUID, p_status: "suspended" }, { p_tenant: TENANT_UUID, p_status: "active" }]);
  });
  it("creates a tenant through admin_create_tenant (slug lookup first)", async () => {
    state.rows.tenants = null;
    const r = await actions.createTenant(fd({ name: "Nilgiri Law", slug: "nilgiri-law", workspace: "Coimbatore", owner: "o@firm.example", hue: "200" }));
    expect(r.ok).toBe(true);
    expect(state.calls.find((x) => x.fn === "admin_create_tenant")?.args).toMatchObject({ p_slug: "nilgiri-law", p_owner_email: "o@firm.example", p_workspace_name: "Coimbatore" });
  });
  it("writes a connector availability cell for a known connector only", async () => {
    expect((await actions.saveConnectorCell(fd({ connector: "csv", env: "production", mode: "live", gate: "ready" }))).ok).toBe(true);
    expect(state.calls.find((x) => x.fn === "upsert:connector_availability")?.args).toMatchObject({ connector_id: "csv", env: "production", mode: "live" });
    expect((await actions.saveConnectorCell(fd({ connector: "ghost", env: "production", mode: "live", gate: "ready" }))).ok).toBe(false);
    expect((await actions.saveConnectorCell(fd({ connector: "csv", env: "prod", mode: "live", gate: "ready" }))).ok).toBe(false);
  });
  it("starts a support session via start_support_session with the validated mode and duration", async () => {
    const ws = "11111111-1111-1111-1111-111111111111";
    await expect(actions.startSupportSession(fd({ ws, reason: "Ticket 142: CSV import failing for Madurai leads", mode: "read_only", minutes: "30" }))).rejects.toThrow(/NEXT_REDIRECT \/$/);
    expect(state.calls.find((x) => x.fn === "start_support_session")?.args).toEqual({ p_workspace_id: ws, p_reason: "Ticket 142: CSV import failing for Madurai leads", p_mode: "read_only", p_minutes: 30 });
  });
  it("rejects a short support reason and a read-write session without a second reason, before the RPC", async () => {
    const ws = "11111111-1111-1111-1111-111111111111";
    await expect(actions.startSupportSession(fd({ ws, reason: "too short", mode: "read_only", minutes: "30" }))).rejects.toThrow(/error=reason$/);
    await expect(actions.startSupportSession(fd({ ws, reason: "Ticket 142: CSV import failing for Madurai", mode: "read_write", minutes: "30" }))).rejects.toThrow(/error=reason2$/);
    expect(state.calls.some((x) => x.fn === "start_support_session")).toBe(false);
  });
});

describe("demo mode never touches the database", () => {
  it("returns demo sentences and makes no rpc or table call", async () => {
    state.demo = true;
    const r1 = await actions.setTenantStatus(fd({ tenant: "lawsome", to: "suspended", confirm: "lawsome" }));
    const r2 = await actions.saveOrgAdminPolicy("lawsome", { allow_api_keys: false }, "a long enough reason");
    const r3 = await actions.saveConnectorCell(fd({ connector: "csv", env: "demo", mode: "live", gate: "ready" }));
    for (const r of [r1, r2, r3]) { expect(r.ok).toBe(true); expect(r.sub).toMatch(/Demo/); }
    expect(state.calls).toEqual([]);
  });
});
