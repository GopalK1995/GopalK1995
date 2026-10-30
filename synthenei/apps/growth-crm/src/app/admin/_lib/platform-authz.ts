// Platform-admin authorization. Platform admins have no workspace, so the workspace principal loader does not apply:
// the principal is built from platform_admins.platform_role (super_admin | support | billing | readonly) and every
// decision still goes through the authz engine (decide), so org state, support overlay and default deny stay in one place.
// Business data is NOT reachable from here: the engine denies every non-platform.* permission for a platform_admin
// principal without a support session (step 4).
import type { Grant, Principal } from "@/lib/authz/types";
import { AuthzError, decide } from "@/lib/authz/engine";

export type PlatformRole = "super_admin" | "support" | "billing" | "readonly";
export const PLATFORM_ROLES: PlatformRole[] = ["super_admin", "support", "billing", "readonly"];
export type PlatformPerm = "platform.tenants.manage" | "platform.policies.manage" | "platform.support" | "platform.billing" | "platform.read";

/** support: read + open sessions, cannot edit policies or tenants. billing: billing only. readonly: read only. */
export const PLATFORM_ROLE_PERMS: Record<PlatformRole, PlatformPerm[]> = {
  super_admin: ["platform.tenants.manage", "platform.policies.manage", "platform.support", "platform.billing", "platform.read"],
  support: ["platform.read", "platform.support"],
  billing: ["platform.billing"],
  readonly: ["platform.read"],
};

export const asPlatformRole = (v: unknown): PlatformRole => (PLATFORM_ROLES.includes(v as PlatformRole) ? (v as PlatformRole) : "readonly");

/** Pure: build the principal. Unknown role degrades to readonly (fail closed). */
export function platformPrincipal(uid: string, role: PlatformRole): Principal {
  const grants: Record<string, Grant> = {};
  for (const p of PLATFORM_ROLE_PERMS[asPlatformRole(role)]) grants[p] = { scope: "all" };
  return {
    kind: "platform_admin", uid, workspaceId: "", tenantId: null, roleKey: role, grants, teamIds: [], teamUserIds: [uid], attrs: {},
    tenant: null, modulesOff: [], support: null, piiFields: ["email", "phone"],
  };
}

/** Pure: throws AuthzError when the role does not include the permission. */
export function assertPlatformFor(uid: string, role: PlatformRole, perm: PlatformPerm): Principal {
  const p = platformPrincipal(uid, role);
  const d = decide(p, perm);
  if (!d.allow) throw new AuthzError(d);
  return p;
}
export const roleCan = (role: PlatformRole, perm: PlatformPerm) => decide(platformPrincipal("-", role), perm).allow;
