import { beforeEach, describe, expect, it, vi } from "vitest";
import { systemGrants } from "@/lib/authz/system-grants";
import { enforce } from "@/lib/authz/engine";
import { systemPrincipal } from "@/lib/authz/principal";
import type { Grant } from "@/lib/authz/types";
import { ROLES } from "@/lib/auth/roles";
import type { Role } from "@/lib/data/types";
import { fakeDb } from "./fakedb";

const all: Grant = { scope: "all" };
const state = vi.hoisted(() => ({
  demo: false, role: "owner" as string, uid: "u-owner", support: null as null | { mode: "read_only" | "read_write" },
  db: null as unknown, dbCalls: 0, serviceInvites: [] as string[], extra: {} as Record<string, unknown>,
}));

vi.mock("@/lib/auth/server", () => ({
  requireActive: async () => ({
    session: { uid: state.uid, demo: state.demo },
    active: { ws: { id: state.demo ? "ws-demo" : "W1", uuid: "W1", name: "Main" }, tenant: { id: "t-demo", name: "Org" }, role: state.role, support: state.support ? { ...state.support, ws: "W1" } : null },
  }),
}));
vi.mock("@/lib/authz/load", async () => {
  const eng = await import("@/lib/authz/engine");
  const pr = await import("@/lib/authz/principal");
  const sg = await import("@/lib/authz/system-grants");
  return {
    assertCan: async (perm: string) => {
      const base = pr.systemPrincipal({ uid: state.uid, workspaceId: "W1", role: state.role as never, support: state.support });
      const extra = (state.extra as Record<string, Grant>);
      const p = { ...base, grants: { ...sg.systemGrants(state.role as never), ...extra } };
      return eng.enforce(p, perm);
    },
  };
});
vi.mock("@/lib/db/client", () => ({ dbForRequest: async () => { state.dbCalls++; return state.db; } }));
vi.mock("@/lib/db/service", () => ({ serviceDb: () => ({ auth: { admin: { inviteUserByEmail: async (e: string) => { state.serviceInvites.push(e); return { error: null }; } } } }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "crm.test" }) }));

import { changeMemberRole, inviteMember, reactivateMember, setMemberTerritory, suspendMember } from "../../../_components/actions";
import { createRole, createTeam, deleteRole, explainAccess, setTeamMember, updateRole } from "../../actions";

void systemPrincipal; void enforce;
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const roleId: Record<string, string> = Object.fromEntries(ROLES.map((r, i) => [r, UUID(i + 1)]));
const CUSTOM = UUID(50);
const sysRoleRows = ROLES.map((r) => ({ id: roleId[r], tenant_id: null, key: r, name: r, description: "", base_role: r, is_system: true, updated_at: "t0" }));
const permRows = ROLES.flatMap((r) => Object.entries(systemGrants(r)).map(([k, g]) => ({ role_id: roleId[r], permission_key: k, scope: g.scope, conditions: g.conditions ?? {}, field_mask: [] })));
const member = (uid: string, role: Role, over: Record<string, unknown> = {}) => ({ id: `m-${uid}`, user_id: uid, workspace_id: "W1", role, role_id: roleId[role], is_active: true, attributes: {}, ...over });
const seed = (over: Record<string, unknown[]> = {}) => ({
  roles: sysRoleRows, role_permissions: permRows,
  memberships: [member("u-owner", "owner"), member("u-mgr", "sales_manager"), member("u-rep", "sales_rep"), member("u-view", "viewer")],
  profiles: ["u-owner", "u-mgr", "u-rep", "u-view", "u-owner2"].map((id) => ({ id, full_name: id, email: `${id}@x.test`, last_seen_at: null })),
  workspaces: [{ id: "W1", tenant_id: "T1" }], org_admin_policies: [{ tenant_id: "T1", allow_custom_roles: true, max_seats: null }],
  teams: [{ id: UUID(70), workspace_id: "W1", name: "North", parent_team_id: null }], team_members: [], territories: [],
  ...over,
}) as Record<string, Record<string, unknown>[]>;

function setup(role: string, uid: string, rows = seed(), o: Parameters<typeof fakeDb>[1] = {}) {
  state.demo = false; state.role = role; state.uid = uid; state.support = null; state.dbCalls = 0; state.serviceInvites = [];
  state.extra = role === "owner"
    ? { "roles.manage": all, "members.invite": all, "teams.manage": all, "members.manage": all }
    : role === "sales_manager" ? { "members.invite": all, "teams.manage": all } : {};
  const f = fakeDb(rows, o);
  state.db = f.db;
  return f;
}
const memberWrites = (f: ReturnType<typeof fakeDb>) => f.writes.filter((w) => w.table === "memberships");
beforeEach(() => { state.serviceInvites = []; });

describe("changeMemberRole / suspend (real mode)", () => {
  it("owner moves a rep to viewer: role_id write through the user client only", async () => {
    const f = setup("owner", "u-owner");
    const r = await changeMemberRole("u-rep", roleId.viewer);
    expect(r.ok).toBe(true);
    expect(memberWrites(f)).toEqual([{ table: "memberships", op: "update", payload: { role_id: roleId.viewer }, match: { workspace_id: "W1", user_id: "u-rep" } }]);
    expect(state.serviceInvites).toEqual([]);
  });
  it("an admin cannot change their own role, so cannot self-escalate", async () => {
    const f = setup("sales_manager", "u-mgr");
    const r = await changeMemberRole("u-mgr", roleId.owner);
    expect(r).toMatchObject({ ok: false, code: "denied" });
    expect(memberWrites(f)).toEqual([]);
  });
  it("the last active owner cannot be demoted or suspended", async () => {
    const f = setup("owner", "u-owner", seed({ memberships: [member("u-owner", "owner"), member("u-owner2", "owner", { is_active: false }), member("u-rep", "sales_rep")] }));
    // a second, different owner acts on the only active owner: build that by acting as owner2 against owner
    state.uid = "u-owner2";
    expect(await changeMemberRole("u-owner", roleId.viewer)).toMatchObject({ ok: false, code: "denied", message: expect.stringContaining("last active Owner") });
    expect(await suspendMember("u-owner")).toMatchObject({ ok: false, code: "denied" });
    expect(memberWrites(f)).toEqual([]);
  });
  it("with two active owners one can be demoted", async () => {
    const f = setup("owner", "u-owner", seed({ memberships: [member("u-owner", "owner"), member("u-owner2", "owner")] }));
    expect((await changeMemberRole("u-owner2", roleId.viewer)).ok).toBe(true);
    expect(memberWrites(f)).toHaveLength(1);
  });
  it("a manager cannot make anyone an owner or touch an owner, but manages reps", async () => {
    const f = setup("sales_manager", "u-mgr");
    expect(await changeMemberRole("u-rep", roleId.owner)).toMatchObject({ ok: false, code: "denied" });
    expect(await suspendMember("u-owner")).toMatchObject({ ok: false, code: "denied" });
    expect(memberWrites(f)).toEqual([]);
    expect((await suspendMember("u-rep")).ok).toBe(true);
    expect(memberWrites(f)).toHaveLength(1);
  });
  it("a manager cannot assign a custom role (no roles.manage)", async () => {
    const rows = seed({ roles: [...sysRoleRows, { id: CUSTOM, tenant_id: "T1", key: "tele", name: "Tele", description: "", base_role: "sales_rep", is_system: false, updated_at: "t0" }], role_permissions: [...permRows, { role_id: CUSTOM, permission_key: "leads.read", scope: "own", conditions: {}, field_mask: [] }] });
    const f = setup("sales_manager", "u-mgr", rows);
    const r = await changeMemberRole("u-rep", CUSTOM);
    expect(r).toMatchObject({ ok: false, code: "denied" });
    expect(memberWrites(f)).toEqual([]);
  });
  it("a viewer cannot manage members at all", async () => {
    const f = setup("viewer", "u-view");
    expect(await changeMemberRole("u-rep", roleId.viewer)).toMatchObject({ ok: false, code: "denied" });
    expect(f.writes).toEqual([]);
  });
  it("reactivate and territory go through the same checks", async () => {
    const f = setup("owner", "u-owner", seed({ memberships: [member("u-owner", "owner"), member("u-rep", "sales_rep", { is_active: false })] }));
    expect((await reactivateMember("u-rep")).ok).toBe(true);
    expect((await setMemberTerritory("u-rep", ["Madurai", "Theni", "Madurai"], ["South"])).ok).toBe(true);
    const terr = f.writes.filter((w) => w.table === "territories" && w.op === "upsert");
    expect(terr).toHaveLength(1);
    expect(terr[0].payload).toEqual([{ workspace_id: "W1", district: "Madurai", rep_id: "u-rep" }, { workspace_id: "W1", district: "Theni", rep_id: "u-rep" }]);
    expect(f.tables.memberships.find((m) => m.user_id === "u-rep")?.attributes).toEqual({ regions: ["South"] });
    expect(await setMemberTerritory("u-owner", ["X"], [])).toMatchObject({ ok: false, code: "denied" }); // own territory: self_change
  });
});

describe("support sessions are blocked", () => {
  it.each([["read_only"], ["read_write"]] as const)("%s: every admin action is refused and nothing is read or written", async (mode) => {
    const f = setup("owner", "u-owner");
    state.support = { mode };
    const results = [
      await inviteMember({ email: "a@b.co", roleId: roleId.viewer }),
      await changeMemberRole("u-rep", roleId.viewer),
      await suspendMember("u-rep"),
      await createRole({ name: "Tele", baseRole: "sales_rep", grants: [] }),
      await createTeam({ name: "South" }),
      await explainAccess({ permission: "leads.read" }),
    ];
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "denied", message: "Not available in a support session." });
    expect(f.writes).toEqual([]);
    expect(state.dbCalls).toBe(0);
  });
});

describe("demo mode never touches Supabase", () => {
  it("validates, applies the same guards, and answers with the demo notice", async () => {
    setup("owner", "u-owner");
    state.demo = true;
    const ok = await inviteMember({ email: "new@x.test", roleId: "sales_rep" });
    expect(ok).toMatchObject({ ok: true });
    expect(ok.ok && ok.sub).toContain("Demo");
    expect(await createRole({ name: "Tele", baseRole: "sales_rep", grants: [{ permission: "leads.read", scope: "own" }] })).toMatchObject({ ok: true });
    expect(await createTeam({ name: "North" })).toMatchObject({ ok: true });
    state.role = "sales_manager"; state.uid = "u-mgr"; state.extra = {};
    expect(await inviteMember({ email: "new@x.test", roleId: "owner" })).toMatchObject({ ok: false, code: "denied" });
    expect(await createRole({ name: "Tele", baseRole: "sales_rep", grants: [] })).toMatchObject({ ok: false, code: "denied" });
    expect(state.dbCalls).toBe(0);
    expect(state.serviceInvites).toEqual([]);
  });
});

describe("invite", () => {
  it("existing user: added by the RPC, no email; new user: invitation row then admin invite email", async () => {
    let n = 0;
    const f = setup("owner", "u-owner", seed(), { rpc: () => (n++ === 0 ? { status: "member_added", user_id: "u-view" } : { status: "invited", invitation_id: "inv1" }) });
    expect((await inviteMember({ email: "Known@X.test", roleId: roleId.sales_rep, districts: ["Madurai"] })).ok).toBe(true);
    expect(f.writes[0]).toMatchObject({ table: "rpc:invite_member", payload: { p_ws: "W1", p_email: "known@x.test", p_role: "sales_rep", p_districts: ["Madurai"] } });
    expect(state.serviceInvites).toEqual([]);
    const r = await inviteMember({ email: "new@x.test", roleId: roleId.viewer });
    expect(r.ok && r.sub).toContain("invite email");
    expect(state.serviceInvites).toEqual(["new@x.test"]);
  });
  it("bad email is invalid; manager cannot invite an owner; no write in either case", async () => {
    const f = setup("sales_manager", "u-mgr");
    expect(await inviteMember({ email: "not-an-email", roleId: roleId.viewer })).toMatchObject({ ok: false, code: "invalid" });
    expect(await inviteMember({ email: "a@b.co", roleId: roleId.owner })).toMatchObject({ ok: false, code: "denied" });
    expect(f.writes).toEqual([]);
  });
  it("respects the seat cap", async () => {
    const f = setup("owner", "u-owner", seed({ org_admin_policies: [{ tenant_id: "T1", allow_custom_roles: true, max_seats: 4 }] }));
    expect(await inviteMember({ email: "a@b.co", roleId: roleId.viewer })).toMatchObject({ ok: false, code: "denied" });
    expect(f.writes).toEqual([]);
  });
});

describe("custom roles", () => {
  const body = (grants: { permission: string; scope: string; conditions?: unknown }[]) => ({ name: "Telecaller", description: "x", baseRole: "sales_rep", grants });
  it("owner creates a role from held permissions: role then role_permissions, tenant from the workspace row", async () => {
    const f = setup("owner", "u-owner");
    const r = await createRole(body([{ permission: "leads.read", scope: "own" }, { permission: "leads.export", scope: "none" }]));
    expect(r.ok).toBe(true);
    const w = f.writes.filter((x) => x.op === "insert");
    expect(w[0]).toMatchObject({ table: "roles", payload: { tenant_id: "T1", key: "telecaller", name: "Telecaller", base_role: "sales_rep", is_system: false } });
    expect(w[1].payload).toMatchObject([{ permission_key: "leads.read", scope: "own" }]);
  });
  it("cannot grant what the caller does not hold, platform-only keys, or roles.manage as a manager", async () => {
    const f = setup("sales_manager", "u-mgr");
    // a manager never reaches the editor: roles.manage is not held
    expect(await createRole(body([{ permission: "leads.read", scope: "own" }]))).toMatchObject({ ok: false, code: "denied" });
    expect(f.writes).toEqual([]);
    const o = setup("owner", "u-owner");
    state.extra = { ...state.extra, "leads.export": undefined as never, "leads.read": { scope: "own" } };
    expect(await createRole(body([{ permission: "leads.read", scope: "all" }]))).toMatchObject({ ok: false, code: "denied", message: "You cannot give more access than you hold yourself." });
    expect(await createRole(body([{ permission: "platform.tenants.manage", scope: "all" }]))).toMatchObject({ ok: false, code: "denied" });
    expect(o.writes).toEqual([]);
  });
  it("a role editor who holds roles.manage but is a Sales Manager still cannot grant roles.manage", async () => {
    const f = setup("sales_manager", "u-mgr");
    state.extra = { ...state.extra, "roles.manage": all };
    expect(await createRole(body([{ permission: "roles.manage", scope: "all" }]))).toMatchObject({ ok: false, code: "denied" });
    expect(f.writes).toEqual([]);
  });
  it("a base role above the caller cannot be smuggled in (base_role feeds legacy owner policies)", async () => {
    const f = setup("owner", "u-owner");
    state.role = "marketing"; state.extra = { "roles.manage": all, "members.manage": all, "leads.read": all };
    expect(await createRole({ ...body([{ permission: "leads.read", scope: "own" }]), baseRole: "owner" })).toMatchObject({ ok: false, code: "denied" });
    expect(f.writes).toEqual([]);
  });
  it("blocked with a reason when the platform switched custom roles off", async () => {
    const f = setup("owner", "u-owner", seed({ org_admin_policies: [{ tenant_id: "T1", allow_custom_roles: false, max_seats: null }] }));
    const r = await createRole(body([{ permission: "leads.read", scope: "own" }]));
    expect(r).toMatchObject({ ok: false, code: "denied", message: "Custom roles are switched off for this organisation." });
    expect(!r.ok && r.sub).toContain("platform administrator");
    expect(f.writes).toEqual([]);
  });
  it("rejects invalid conditions", async () => {
    const f = setup("owner", "u-owner");
    const r = await createRole(body([{ permission: "leads.read", scope: "own", conditions: { all: [{ field: "record.x", op: "regex", value: "x" }] } }]));
    expect(r).toMatchObject({ ok: false, code: "denied" });
    expect(f.writes).toEqual([]);
  });
  it("update: optimistic updated_at, system roles read-only, removed permissions are deleted", async () => {
    const rows = seed({ roles: [...sysRoleRows, { id: CUSTOM, tenant_id: "T1", key: "tele", name: "Tele", description: "", base_role: "sales_rep", is_system: false, updated_at: "2026-10-30T10:00:00Z" }],
      role_permissions: [...permRows, { role_id: CUSTOM, permission_key: "leads.read", scope: "own", conditions: {}, field_mask: [] }, { role_id: CUSTOM, permission_key: "leads.write", scope: "own", conditions: {}, field_mask: [] }] });
    const f = setup("owner", "u-owner", rows);
    const input = { roleId: CUSTOM, name: "Tele", description: "", baseRole: "sales_rep", grants: [{ permission: "leads.read", scope: "team" }], expectedUpdatedAt: "2026-10-29T10:00:00Z" };
    expect(await updateRole(input)).toMatchObject({ ok: false, code: "conflict" });
    expect(f.writes.filter((w) => w.table === "role_permissions")).toEqual([]);
    expect((await updateRole({ ...input, expectedUpdatedAt: "2026-10-30T10:00:00Z" })).ok).toBe(true);
    expect(f.tables.role_permissions.filter((p) => p.role_id === CUSTOM).map((p) => p.permission_key)).toEqual(["leads.read"]);
    expect(await updateRole({ ...input, roleId: roleId.viewer, expectedUpdatedAt: "2026-10-30T10:00:00Z" })).toMatchObject({ ok: false, code: "denied", message: "System roles cannot be edited." });
  });
  it("delete refuses a role in use and system roles", async () => {
    const rows = seed({ roles: [...sysRoleRows, { id: CUSTOM, tenant_id: "T1", key: "tele", name: "Tele", description: "", base_role: "sales_rep", is_system: false, updated_at: "2026-10-30T10:00:00Z" }], memberships: [member("u-owner", "owner"), member("u-rep", "sales_rep", { role_id: CUSTOM })] });
    const f = setup("owner", "u-owner", rows);
    expect(await deleteRole({ roleId: CUSTOM })).toMatchObject({ ok: false, code: "invalid" });
    expect(await deleteRole({ roleId: roleId.viewer })).toMatchObject({ ok: false, code: "denied" });
    expect(f.writes.filter((w) => w.op === "delete")).toEqual([]);
  });
  it("explain access traces a role against a permission", async () => {
    setup("owner", "u-owner");
    const r = await explainAccess({ permission: "leads.export", roleId: roleId.sales_rep });
    expect(r.ok && r.data?.allow).toBe(false);
    expect(r.ok && r.data?.steps.length).toBeGreaterThan(0);
    const ok = await explainAccess({ permission: "leads.read", roleId: roleId.owner });
    expect(ok.ok && ok.data?.allow).toBe(true);
  });
});

describe("teams", () => {
  it("manager can create a team and add a rep, but not make themselves team manager", async () => {
    const f = setup("sales_manager", "u-mgr");
    expect((await createTeam({ name: "South" })).ok).toBe(true);
    expect((await setTeamMember({ teamId: UUID(70), userId: "u-rep", isManager: false })).ok).toBe(true);
    expect(await setTeamMember({ teamId: UUID(70), userId: "u-mgr", isManager: true })).toMatchObject({ ok: false, code: "denied" });
    expect(f.tables.team_members).toEqual([{ team_id: UUID(70), user_id: "u-rep", is_manager: false }]);
  });
  it("a team from another workspace and a non-member are refused", async () => {
    const f = setup("owner", "u-owner");
    expect(await setTeamMember({ teamId: UUID(99), userId: "u-rep", isManager: false })).toMatchObject({ ok: false, code: "not_found" });
    expect(await setTeamMember({ teamId: UUID(70), userId: "stranger", isManager: false })).toMatchObject({ ok: false, code: "not_found" });
    expect(f.writes.filter((w) => w.table === "team_members")).toEqual([]);
  });
  it("a viewer cannot create teams", async () => {
    const f = setup("viewer", "u-view");
    expect(await createTeam({ name: "South" })).toMatchObject({ ok: false, code: "denied" });
    expect(f.writes).toEqual([]);
  });
});
