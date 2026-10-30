import { describe, expect, it } from "vitest";
import { decide } from "@/lib/authz/engine";
import { systemPrincipal } from "@/lib/authz/principal";
import { AuthzError } from "@/lib/authz/engine";
import { PLATFORM_ROLES, PLATFORM_ROLE_PERMS, assertPlatformFor, asPlatformRole, platformPrincipal, roleCan, type PlatformPerm } from "../_lib/platform-authz";
import { checkPolicyPatch, diffPolicy } from "../_lib/policy";
import { DEFAULT_POLICY } from "../_lib/repo";

const ALL: PlatformPerm[] = ["platform.tenants.manage", "platform.policies.manage", "platform.support", "platform.billing", "platform.read"];

describe("platform roles through the authz engine", () => {
  it("super_admin holds every platform permission", () => {
    for (const p of ALL) expect(roleCan("super_admin", p)).toBe(true);
  });
  it("support can read and open sessions but cannot edit policies or tenants", () => {
    expect(roleCan("support", "platform.read")).toBe(true);
    expect(roleCan("support", "platform.support")).toBe(true);
    expect(roleCan("support", "platform.policies.manage")).toBe(false);
    expect(roleCan("support", "platform.tenants.manage")).toBe(false);
  });
  it("billing sees billing only", () => {
    expect(PLATFORM_ROLE_PERMS.billing).toEqual(["platform.billing"]);
    for (const p of ALL.filter((x) => x !== "platform.billing")) expect(roleCan("billing", p)).toBe(false);
  });
  it("readonly can only read", () => {
    for (const p of ALL.filter((x) => x !== "platform.read")) expect(roleCan("readonly", p)).toBe(false);
    expect(roleCan("readonly", "platform.read")).toBe(true);
  });
  it("unknown role strings degrade to readonly (fail closed)", () => {
    expect(asPlatformRole("root")).toBe("readonly");
    expect(asPlatformRole(undefined)).toBe("readonly");
    expect(roleCan(asPlatformRole("root"), "platform.policies.manage")).toBe(false);
  });
  it("assertPlatformFor throws AuthzError for a missing permission", () => {
    expect(() => assertPlatformFor("u1", "support", "platform.policies.manage")).toThrow(AuthzError);
    expect(assertPlatformFor("u1", "super_admin", "platform.policies.manage").kind).toBe("platform_admin");
  });
  it("a platform admin has no business data without a support session, for every role", () => {
    for (const r of PLATFORM_ROLES) {
      const p = platformPrincipal("u1", r);
      for (const perm of ["leads.read", "leads.export", "contacts.read", "pii.read", "deals.move", "audit.read"]) {
        expect(decide(p, perm).allow).toBe(false);
      }
    }
  });
});

describe("a tenant user cannot reach admin permissions", () => {
  it.each(["owner", "sales_manager", "sales_rep", "viewer"] as const)("%s is denied every platform.* permission", (role) => {
    const p = systemPrincipal({ uid: "u1", workspaceId: "w1", role });
    for (const perm of ALL) expect(decide(p, perm).allow).toBe(false);
  });
});

describe("org-admin policy validation", () => {
  const connectors = ["csv", "whatsapp"];
  it("accepts booleans, caps, null and known lists", () => {
    const r = checkPolicyPatch({ allow_api_keys: false, max_seats: 25, max_workspaces: null, allowed_modules: ["inbox", "tasks"], allow_connectors: ["csv"] }, connectors);
    expect(r.ok).toBe(true);
  });
  it.each([
    [{ max_seats: -1 }, "badNumber"], [{ max_seats: 1.5 }, "badNumber"], [{ max_seats: "9" }, "badNumber"],
    [{ allowed_modules: ["nope"] }, "badList"], [{ allow_connectors: ["unknown"] }, "badList"],
    [{ allow_api_keys: "yes" }, "badType"], [{ tenant_id: "x" }, "unknownKey"],
  ])("rejects %j", (patch, code) => {
    const r = checkPolicyPatch(patch, connectors);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });
  it("diffPolicy keeps only changed keys and ignores list order", () => {
    const cur = { ...DEFAULT_POLICY("t1"), allowedModules: ["inbox", "tasks"] };
    const r = checkPolicyPatch({ allow_api_keys: true, allow_byok: true, allowed_modules: ["tasks", "inbox"], max_seats: 5 }, connectors);
    expect(r.ok).toBe(true);
    if (r.ok) expect(diffPolicy(cur, r.patch)).toEqual({ allow_byok: true, max_seats: 5 });
  });
});
