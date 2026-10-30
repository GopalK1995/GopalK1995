// Shared helpers for the org-admin server actions: demo fixtures shaped like the real records, role and member
// resolution, and mapping of guard verdicts to ActionResult. Not a "use server" file.
import { failResult, runAction, type ActionResult } from "@/lib/actions/result";
import { throwIfError, type PgErrorLike } from "@/lib/db/errors";
import type { Db } from "@/lib/db/client";
import { systemGrants } from "@/lib/authz/system-grants";
import { ROLES, ROLE_LABEL } from "@/lib/auth/roles";
import { MEMBERSHIPS, USERS } from "@/lib/tenancy";
import type { AdminCtx } from "./ctx";
import { grantsToInputs, type MemberCheck, type RoleRef } from "./guards";
import { sa } from "./strings";
import { loadMembers, loadPolicy, loadRoles, type MemberRecord, type Policy, type RoleRecord } from "./store";

/** The six system roles as records. Demo ids are the role keys; real system roles have uuid ids from the roles table. */
export function demoRoles(): RoleRecord[] {
  return ROLES.map((r) => ({ id: r, key: r, name: ROLE_LABEL[r], description: "", baseRole: r, isSystem: true, tenantId: null, updatedAt: "", grants: grantsToInputs(systemGrants(r)) }));
}
export function demoMembers(wsId: string): MemberRecord[] {
  return MEMBERSHIPS.filter((m) => m.workspaceId === wsId).map((m) => {
    const u = USERS.find((x) => x.id === m.userId);
    return { userId: m.userId, membershipId: `${m.userId}:${m.workspaceId}`, name: u?.name ?? m.userId, email: u?.email ?? "", baseRole: m.role, roleId: m.role, isActive: u?.status !== "deactivated", districts: [], regions: [], lastSeenAt: u?.lastSignIn ?? null };
  });
}

export interface World { roles: RoleRecord[]; members: MemberRecord[]; policy: Policy }
export async function loadWorld(c: AdminCtx, db: Db | null): Promise<World> {
  if (c.demo || !db) return { roles: demoRoles(), members: demoMembers(c.ws), policy: { allowCustomRoles: true, maxSeats: null } };
  const [roles, members, policy] = await Promise.all([loadRoles(db, c.tenant), loadMembers(db, c.ws), loadPolicy(db, c.tenant)]);
  return { roles, members, policy };
}

export const refOf = (r: RoleRecord): RoleRef => ({ baseRole: r.baseRole, custom: !r.isSystem, grants: r.grants });
export const roleOfMember = (roles: RoleRecord[], m: MemberRecord): RoleRecord | undefined =>
  roles.find((r) => r.id === m.roleId) ?? roles.find((r) => r.isSystem && r.key === m.baseRole);

export const denied = (message: string, sub?: string): ActionResult<never> => failResult("denied", message, sub ? { sub } : undefined);

/** Guard verdict to a failed ActionResult with a specific reason (and the first offending permissions in `sub`). */
export function verdict(check: MemberCheck): ActionResult<never> | null {
  if (check.ok) return null;
  const perms = check.violations?.slice(0, 4).map((v) => v.permission).join(", ");
  return denied(sa(`deny_${check.code}`), perms ? sa("deny_perms", { perms }) : undefined);
}

export async function rpc(db: Db, name: string, args: Record<string, unknown>): Promise<unknown> {
  const r = await (db as unknown as { rpc(n: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: PgErrorLike | null }> }).rpc(name, args);
  throwIfError(r.error);
  return r.data;
}

/** Custom roles are blocked when the platform policy says so; the message carries the reason. */
export const customRolesBlocked = (p: Policy): ActionResult<never> | null => (p.allowCustomRoles ? null : denied(sa("customRolesOff"), sa("customRolesOffWhy")));

const AUTHZ_REASONS = ["unauthenticated", "org_suspended", "org_readonly", "module_off", "plan_limit", "support_blocked", "support_readonly", "no_permission", "out_of_scope", "condition_failed"];
/** runAction plus readable, translated messages for authz denials and database errors. */
export async function act<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const r = await runAction(fn);
  if (r.ok) return r;
  if (r.code === "denied" && r.message.startsWith("errors.authz.")) {
    const reason = r.message.slice("errors.authz.".length);
    return { ...r, message: sa(AUTHZ_REASONS.includes(reason) ? `authz_${reason}` : "authz_no_permission") };
  }
  if (r.code === "denied" && r.message === "You do not have permission to do that.") return { ...r, message: sa("authz_no_permission") };
  if (r.code === "conflict") return { ...r, message: sa("conflictTitle"), sub: sa("conflictBody") };
  if (r.code === "not_found" && r.message.startsWith("That record")) return { ...r, message: sa("notFound") };
  if (r.code === "invalid" && !r.issues) return { ...r, message: sa("invalidBody") };
  if (r.code === "error") return { ...r, message: sa("errorTitle"), sub: sa("errorBody") };
  return r;
}
