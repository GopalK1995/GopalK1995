import { describe, expect, it } from "vitest";
import { systemGrants } from "@/lib/authz/system-grants";
import type { Grant } from "@/lib/authz/types";
import { checkMemberChange, checkRoleAssignment, checkRoleGrants, conditionsCover, grantsToInputs, type Actor, type BaseRole, type RoleRef } from "../guards";

const all: Grant = { scope: "all" };
const ownerHeld = (): Record<string, Grant> => ({ ...systemGrants("owner"), "roles.manage": all, "members.manage": all, "members.invite": all, "teams.manage": all });
const managerHeld = (): Record<string, Grant> => ({ ...systemGrants("sales_manager"), "members.invite": all, "teams.manage": all });
const owner: Actor = { uid: "u-owner", baseRole: "owner", held: ownerHeld() };
const manager: Actor = { uid: "u-mgr", baseRole: "sales_manager", held: managerHeld() };
const sys = (baseRole: BaseRole): RoleRef => ({ baseRole, custom: false });
const custom = (grants: { permission: string; scope: "all" | "team" | "own" | "none"; conditions?: unknown }[], baseRole: BaseRole = "sales_rep"): RoleRef => ({ baseRole, custom: true, grants });
const target = (role: RoleRef, userId = "u-t", isActive = true) => ({ userId, role, isActive });

describe("checkRoleGrants: nobody grants what they do not hold", () => {
  it("allows a subset at equal or lower scope", () => {
    expect(checkRoleGrants(managerHeld(), [{ permission: "leads.read", scope: "own" }, { permission: "leads.write", scope: "all" }])).toEqual([]);
  });
  it("rejects a permission the caller does not hold", () => {
    expect(checkRoleGrants(managerHeld(), [{ permission: "leads.export", scope: "all" }])).toEqual([{ code: "not_held", permission: "leads.export" }]);
  });
  it("rejects a wider scope than held", () => {
    const held = { "leads.read": { scope: "own" } as Grant };
    expect(checkRoleGrants(held, [{ permission: "leads.read", scope: "team" }])[0].code).toBe("exceeds_scope");
    expect(checkRoleGrants(held, [{ permission: "leads.read", scope: "all" }])[0].code).toBe("exceeds_scope");
    expect(checkRoleGrants(held, [{ permission: "leads.read", scope: "own" }])).toEqual([]);
  });
  it("scope none is always allowed", () => {
    expect(checkRoleGrants({}, [{ permission: "leads.export", scope: "none" }])).toEqual([]);
  });
  it("a manager cannot grant roles.manage, even if it were somehow held", () => {
    expect(checkRoleGrants(managerHeld(), [{ permission: "roles.manage", scope: "all" }], { actorBaseRole: "sales_manager" })[0].code).toBe("roles_manage_restricted");
    const odd = { ...managerHeld(), "roles.manage": all };
    expect(checkRoleGrants(odd, [{ permission: "roles.manage", scope: "all" }], { actorBaseRole: "sales_manager" })[0].code).toBe("roles_manage_restricted");
  });
  it("roles.manage needs scope All in the grantor", () => {
    const team = { ...ownerHeld(), "roles.manage": { scope: "team" } as Grant };
    expect(checkRoleGrants(team, [{ permission: "roles.manage", scope: "team" }])[0].code).toBe("roles_manage_restricted");
    expect(checkRoleGrants(ownerHeld(), [{ permission: "roles.manage", scope: "all" }])).toEqual([]);
  });
  it("platform-only and unknown permissions are never grantable", () => {
    expect(checkRoleGrants(ownerHeld(), [{ permission: "platform.tenants.manage", scope: "all" }])[0].code).toBe("platform_only");
    expect(checkRoleGrants(ownerHeld(), [{ permission: "nope.nothing", scope: "all" }])[0].code).toBe("unknown_permission");
    expect(checkRoleGrants({ "obj:vehicle.read": all }, [{ permission: "obj:vehicle.read", scope: "own" }])).toEqual([]);
  });
  it("rejects invalid conditions (fail closed)", () => {
    const v = checkRoleGrants(ownerHeld(), [{ permission: "leads.read", scope: "all", conditions: { all: [{ field: "record.x", op: "regex", value: "a" }] } }]);
    expect(v[0].code).toBe("conditions_invalid");
  });
  it("cannot drop a condition the grantor is bound by, but may add more", () => {
    const cond = { all: [{ field: "now", op: "between_hours", value: ["09:00", "20:00"], tz: "Asia/Kolkata" }] };
    const held = { "leads.read": { scope: "all", conditions: cond } as Grant };
    expect(checkRoleGrants(held, [{ permission: "leads.read", scope: "all" }])[0].code).toBe("conditions_weaker");
    expect(checkRoleGrants(held, [{ permission: "leads.read", scope: "all", conditions: { all: [{ field: "record.district", op: "in", value: "@principal.attrs.districts" }] } }])[0].code).toBe("conditions_weaker");
    expect(checkRoleGrants(held, [{ permission: "leads.read", scope: "all", conditions: cond }])).toEqual([]);
    const tighter = { all: [...cond.all, { field: "record.district", op: "in", value: "@principal.attrs.districts" }] };
    expect(checkRoleGrants(held, [{ permission: "leads.read", scope: "all", conditions: tighter }])).toEqual([]);
  });
  it("cannot unmask fields the grantor cannot see", () => {
    const held = { "leads.read": { scope: "all", fieldMask: ["phone"] } as Grant };
    expect(checkRoleGrants(held, [{ permission: "leads.read", scope: "all", fieldMask: [] }])[0].code).toBe("mask_weaker");
    expect(checkRoleGrants(held, [{ permission: "leads.read", scope: "all", fieldMask: ["phone", "email"] }])).toEqual([]);
  });
  it("conditionsCover handles empty and equal trees", () => {
    expect(conditionsCover({}, {})).toBe(true);
    expect(conditionsCover({}, { all: [{ field: "a", op: "eq", value: 1 }] })).toBe(false);
    expect(conditionsCover({ all: [{ value: 1, op: "eq", field: "a" }] }, { all: [{ field: "a", op: "eq", value: 1 }] })).toBe(true);
  });
});

describe("checkMemberChange", () => {
  it("an admin cannot edit their own role (no self escalation), nor suspend themselves", () => {
    const me = target(sys("sales_manager"), "u-owner");
    expect(checkMemberChange(owner, me, { kind: "role", to: sys("owner") }, 3)).toEqual({ ok: false, code: "self_change" });
    expect(checkMemberChange(owner, me, { kind: "suspend" }, 3)).toEqual({ ok: false, code: "self_change" });
  });
  it("the last active owner cannot be demoted or suspended; with two owners it can", () => {
    const o = target(sys("owner"), "u-o2");
    expect(checkMemberChange(owner, o, { kind: "role", to: sys("sales_manager") }, 1)).toEqual({ ok: false, code: "last_owner" });
    expect(checkMemberChange(owner, o, { kind: "suspend" }, 1)).toEqual({ ok: false, code: "last_owner" });
    expect(checkMemberChange(owner, o, { kind: "role", to: custom([], "marketing") }, 1)).toMatchObject({ ok: false, code: "last_owner" });
    expect(checkMemberChange(owner, o, { kind: "role", to: sys("sales_manager") }, 2)).toEqual({ ok: true });
    expect(checkMemberChange(owner, o, { kind: "suspend" }, 2)).toEqual({ ok: true });
  });
  it("keeping the owner role is not a demotion", () => {
    expect(checkMemberChange(owner, target(sys("owner"), "u-o2"), { kind: "role", to: sys("owner") }, 1)).toEqual({ ok: true });
  });
  it("an inactive owner does not count as the last owner", () => {
    expect(checkMemberChange(owner, target(sys("owner"), "u-o2", false), { kind: "role", to: sys("viewer") }, 1)).toEqual({ ok: true });
  });
  it("a manager only moves reps and viewers between rep and viewer", () => {
    expect(checkMemberChange(manager, target(sys("sales_rep")), { kind: "role", to: sys("viewer") }, 2)).toEqual({ ok: true });
    expect(checkMemberChange(manager, target(sys("sales_rep")), { kind: "role", to: sys("owner") }, 2)).toEqual({ ok: false, code: "owner_only" });
    expect(checkMemberChange(manager, target(sys("sales_rep")), { kind: "role", to: sys("marketing") }, 2)).toEqual({ ok: false, code: "out_of_scope" });
    expect(checkMemberChange(manager, target(sys("marketing")), { kind: "role", to: sys("viewer") }, 2)).toEqual({ ok: false, code: "out_of_scope" });
    expect(checkMemberChange(manager, target(sys("owner")), { kind: "suspend" }, 2)).toEqual({ ok: false, code: "owner_only" });
  });
  it("a manager cannot assign any custom role (no roles.manage)", () => {
    expect(checkMemberChange(manager, target(sys("sales_rep")), { kind: "role", to: custom([{ permission: "leads.read", scope: "own" }]) }, 2)).toEqual({ ok: false, code: "needs_roles_manage" });
  });
  it("an owner assigns a custom role within their holdings but not beyond", () => {
    expect(checkMemberChange(owner, target(sys("viewer")), { kind: "role", to: custom([{ permission: "leads.read", scope: "own" }]) }, 2)).toEqual({ ok: true });
    const limited: Actor = { uid: "u-a", baseRole: "owner", held: { "roles.manage": all, "members.manage": all, "leads.read": { scope: "own" } } };
    expect(checkMemberChange(limited, target(sys("viewer")), { kind: "role", to: custom([{ permission: "leads.read", scope: "all" }]) }, 2)).toMatchObject({ ok: false, code: "role_exceeds_you" });
  });
  it("a custom-role admin cannot edit someone who holds more than they do", () => {
    const admin: Actor = { uid: "u-a", baseRole: "marketing", held: { "roles.manage": all, "members.manage": all, "leads.read": { scope: "own" } } };
    const strong = custom([{ permission: "leads.read", scope: "all" }]);
    expect(checkMemberChange(admin, target(strong), { kind: "role", to: sys("viewer") }, 2)).toMatchObject({ ok: false, code: "role_exceeds_you" });
  });
  it("only an owner changes an owner", () => {
    const admin: Actor = { uid: "u-a", baseRole: "marketing", held: { "roles.manage": all, "members.manage": all } };
    expect(checkMemberChange(admin, target(sys("owner")), { kind: "role", to: sys("viewer") }, 3)).toEqual({ ok: false, code: "owner_only" });
  });
});

describe("checkRoleAssignment (invite)", () => {
  it("manager invites reps and viewers only", () => {
    expect(checkRoleAssignment(manager, sys("sales_rep"))).toEqual({ ok: true });
    expect(checkRoleAssignment(manager, sys("owner"))).toEqual({ ok: false, code: "owner_only" });
    expect(checkRoleAssignment(manager, sys("data"))).toEqual({ ok: false, code: "out_of_scope" });
  });
  it("grantsToInputs lists a system role", () => {
    expect(grantsToInputs(systemGrants("viewer")).length).toBeGreaterThan(0);
  });
});
