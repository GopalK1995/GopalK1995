// Privilege-escalation rules for user, role and team administration. Pure and dependency-light so the server actions
// call them on every write and the unit tests pin them. The database enforces the same rules (guard_membership_change,
// role_within_caller, roles/role_permissions RLS); these checks are the first line and give readable reasons.
import { validateConditions } from "@/lib/authz/conditions";
import { PERMISSION_BY_KEY } from "@/lib/authz/catalog";
import type { Grant, Scope } from "@/lib/authz/types";

const RANK: Record<Scope, number> = { none: 0, own: 1, team: 2, all: 3 };
export const SCOPES: Scope[] = ["none", "own", "team", "all"];
export const scopeRank = (s: Scope): number => RANK[s] ?? 0;
const OBJ_PERM = /^obj:[a-z][a-z0-9_]{0,40}\.(read|write|delete)$/;

export type BaseRole = "owner" | "sales_manager" | "sales_rep" | "marketing" | "data" | "viewer";
export const MANAGER_SCOPE: BaseRole[] = ["sales_rep", "viewer"];

export interface GrantInput { permission: string; scope: Scope; conditions?: unknown; fieldMask?: string[] }
export type ViolationCode =
  | "unknown_permission" | "platform_only" | "not_held" | "exceeds_scope" | "roles_manage_restricted"
  | "conditions_invalid" | "conditions_weaker" | "mask_weaker";
export interface Violation { code: ViolationCode; permission: string; detail?: string }

const isEmptyCond = (c: unknown): boolean => c == null || (typeof c === "object" && !Array.isArray(c) && Object.keys(c as object).length === 0);
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => a.localeCompare(b))) : x));
/** True when `wanted` is at least as restrictive as `held`: the same tree, or an `all` that includes every held clause. */
export function conditionsCover(wanted: unknown, held: unknown): boolean {
  if (isEmptyCond(held)) return true;
  if (isEmptyCond(wanted)) return false;
  if (canon(wanted) === canon(held)) return true;
  const w = wanted as { all?: unknown[] }, h = held as { all?: unknown[]; any?: unknown[] };
  if (!Array.isArray(w.all)) return false;
  const have = new Set(w.all.map(canon));
  if (Array.isArray(h.all)) return h.all.every((c) => have.has(canon(c)));
  return have.has(canon(held));
}

/**
 * Can a caller holding `held` hand out `wanted`? Nobody grants a permission they do not hold, at a wider scope, with
 * looser conditions or with a smaller field mask. roles.manage additionally needs scope `all` and is never grantable by a
 * Sales Manager. Platform-only and unknown permission keys are never grantable. `scope: none` is always allowed.
 */
export function checkRoleGrants(held: Record<string, Grant>, wanted: GrantInput[], opts: { actorBaseRole?: BaseRole } = {}): Violation[] {
  const out: Violation[] = [];
  for (const w of wanted) {
    const def = PERMISSION_BY_KEY.get(w.permission);
    if (!def && !OBJ_PERM.test(w.permission)) { out.push({ code: "unknown_permission", permission: w.permission }); continue; }
    if (def?.platformOnly) { out.push({ code: "platform_only", permission: w.permission }); continue; }
    if (!SCOPES.includes(w.scope)) { out.push({ code: "exceeds_scope", permission: w.permission, detail: "scope" }); continue; }
    if (w.scope === "none") continue;
    if (!isEmptyCond(w.conditions)) {
      const issues = validateConditions(w.conditions);
      if (issues.length) { out.push({ code: "conditions_invalid", permission: w.permission, detail: issues[0].message }); continue; }
    }
    const h = held[w.permission];
    if (w.permission === "roles.manage" && (opts.actorBaseRole === "sales_manager" || !h || h.scope !== "all")) {
      out.push({ code: "roles_manage_restricted", permission: w.permission }); continue;
    }
    if (!h || h.scope === "none") { out.push({ code: "not_held", permission: w.permission }); continue; }
    if (scopeRank(w.scope) > scopeRank(h.scope)) { out.push({ code: "exceeds_scope", permission: w.permission, detail: `${w.scope}>${h.scope}` }); continue; }
    if (!conditionsCover(w.conditions, h.conditions)) { out.push({ code: "conditions_weaker", permission: w.permission }); continue; }
    const heldMask = h.fieldMask ?? [];
    if (heldMask.length && !heldMask.every((f) => (w.fieldMask ?? []).includes(f))) out.push({ code: "mask_weaker", permission: w.permission });
  }
  return out;
}

export const grantsToInputs = (g: Record<string, Grant>): GrantInput[] =>
  Object.entries(g).map(([permission, v]) => ({ permission, scope: v.scope, conditions: v.conditions, fieldMask: v.fieldMask }));

export type MemberDenyCode = "self_change" | "last_owner" | "out_of_scope" | "needs_roles_manage" | "role_exceeds_you" | "owner_only";
export type MemberCheck = { ok: true } | { ok: false; code: MemberDenyCode; violations?: Violation[] };

export interface Actor { uid: string; baseRole: BaseRole; held: Record<string, Grant> }
export interface RoleRef { baseRole: BaseRole; custom: boolean; grants?: GrantInput[] }
export interface MemberTarget { userId: string; role: RoleRef; isActive: boolean }

/**
 * Role change / suspend / reactivate of an existing member. `to` is the new role (omit for suspend).
 * Order matters: self first (an admin cannot edit their own role to escalate), then the last-owner rule, then scope.
 */
export function checkMemberChange(actor: Actor, target: MemberTarget, change: { kind: "role"; to: RoleRef } | { kind: "suspend" } | { kind: "reactivate" }, activeOwners: number): MemberCheck {
  if (target.userId === actor.uid) return { ok: false, code: "self_change" };
  const toBase = change.kind === "role" ? change.to.baseRole : target.role.baseRole;
  if (target.isActive && target.role.baseRole === "owner" && (change.kind === "suspend" || toBase !== "owner") && activeOwners <= 1) return { ok: false, code: "last_owner" };
  return checkRoleAssignment(actor, change.kind === "role" ? change.to : target.role, target);
}

/** Shared by invite (no target) and role change: may this actor put someone into `to`? */
export function checkRoleAssignment(actor: Actor, to: RoleRef, target?: MemberTarget): MemberCheck {
  if ((to.baseRole === "owner" || target?.role.baseRole === "owner") && actor.baseRole !== "owner") return { ok: false, code: "owner_only" };
  const custom = to.custom || !!target?.role.custom;
  if (custom) {
    if (actor.held["roles.manage"]?.scope !== "all" || actor.baseRole === "sales_manager") return { ok: false, code: "needs_roles_manage" };
    const v = checkRoleGrants(actor.held, [...(to.grants ?? []), ...(target?.role.custom ? target.role.grants ?? [] : [])], { actorBaseRole: actor.baseRole });
    if (v.length) return { ok: false, code: "role_exceeds_you", violations: v };
    return { ok: true };
  }
  if (actor.baseRole === "owner") return { ok: true };
  if (actor.baseRole === "sales_manager" && MANAGER_SCOPE.includes(to.baseRole) && (!target || MANAGER_SCOPE.includes(target.role.baseRole))) return { ok: true };
  return { ok: false, code: "out_of_scope" };
}

export function isoOk(s: string | null | undefined): boolean { return !!s && !Number.isNaN(Date.parse(s)); }
