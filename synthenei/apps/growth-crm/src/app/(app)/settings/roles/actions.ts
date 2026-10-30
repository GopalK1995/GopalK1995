"use server";
// Custom roles, teams and the explain-access panel. Every action: zod -> assertCan (via adminCtx) -> escalation guards ->
// repository write (RLS and the guard triggers re-check; audit triggers on roles, role_permissions, teams, team_members record it).
// Demo sessions run the same checks and answer without touching a database.
import { failResult, okResult, type ActionResult as Result } from "@/lib/actions/result";
import { explain } from "@/lib/authz/engine";
import { adminCtx, realDb } from "./_lib/ctx";
import { checkRoleAssignment, checkRoleGrants, type GrantInput } from "./_lib/guards";
import { act, customRolesBlocked, denied, loadWorld, verdict } from "./_lib/ops";
import { createRoleSchema, deleteRoleSchema, deleteTeamSchema, explainSchema, removeTeamMemberSchema, teamMemberSchema, teamSchema, updateRoleSchema, updateTeamSchema } from "./_lib/schemas";
import * as S from "./_lib/store";
import { sa } from "./_lib/strings";
import type { Principal } from "@/lib/authz/types";
import type { ExplainView } from "./_lib/types";


const keyOf = (name: string, taken: Set<string>): string => {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "r_").slice(0, 36) || "role";
  let k = base, i = 2;
  while (taken.has(k)) k = `${base}_${i++}`;
  return k;
};
const escalation = (v: ReturnType<typeof checkRoleGrants>): Result<never> =>
  denied(sa("deny_role_exceeds_you"), sa("deny_perms", { perms: v.slice(0, 4).map((x) => `${x.permission} (${sa(`viol_${x.code}`)})`).join(", ") }));

/** Both create and update: grants within the caller's holdings, base role within what the caller may assign, valid conditions. */
function gate(c: Awaited<ReturnType<typeof adminCtx>>, baseRole: string, grants: GrantInput[]): Result<never> | null {
  const base = verdict(checkRoleAssignment(c.actor, { baseRole: baseRole as never, custom: false }));
  if (base) return base;
  const v = checkRoleGrants(c.actor.held, grants, { actorBaseRole: c.actor.baseRole });
  return v.length ? escalation(v) : null;
}

export async function createRole(input: unknown): Promise<Result<{ id: string }>> {
  return act(async () => {
    const v = createRoleSchema.parse(input);
    const c = await adminCtx("roles.manage");
    const db = c.demo ? null : await realDb(c);
    const w = await loadWorld(c, db);
    const off = customRolesBlocked(w.policy);
    if (off) return off;
    const bad = gate(c, v.baseRole, v.grants);
    if (bad) return bad;
    if (w.roles.some((r) => !r.isSystem && r.name.toLowerCase() === v.name.toLowerCase())) return failResult("invalid", sa("roleNameTaken"));
    if (c.demo || !db) return okResult(sa("roleCreated", { name: v.name }), { sub: sa("demoNotice") });
    const row = await S.createRole(db, c.tenant, { key: keyOf(v.name, new Set(w.roles.map((r) => r.key))), name: v.name, description: v.description, baseRole: v.baseRole, grants: v.grants });
    return okResult(sa("roleCreated", { name: v.name }), { data: { id: row.id } });
  });
}

export async function updateRole(input: unknown): Promise<Result> {
  return act(async () => {
    const v = updateRoleSchema.parse(input);
    const c = await adminCtx("roles.manage");
    const db = c.demo ? null : await realDb(c);
    const w = await loadWorld(c, db);
    const off = customRolesBlocked(w.policy);
    if (off) return off;
    const role = w.roles.find((r) => r.id === v.roleId);
    if (!role) return failResult("not_found", sa("roleNotFound"));
    if (role.isSystem) return denied(sa("systemRoleReadOnly"), sa("systemRoleReadOnlyWhy"));
    // The role as it will be after the save must be entirely within the caller's holdings (this also stops the caller
    // from editing a role they hold, or one that already holds more than they do, to widen it).
    const bad = gate(c, v.baseRole, v.grants);
    if (bad) return bad;
    if (c.demo || !db) return okResult(sa("roleSaved", { name: v.name }), { sub: sa("demoNotice") });
    await S.updateRole(db, c.tenant, role.id, v.expectedUpdatedAt, { name: v.name, description: v.description, baseRole: v.baseRole, grants: v.grants });
    return okResult(sa("roleSaved", { name: v.name }), { sub: sa("roleSavedSub") });
  });
}

export async function deleteRole(input: unknown): Promise<Result> {
  return act(async () => {
    const v = deleteRoleSchema.parse(input);
    const c = await adminCtx("roles.manage");
    const db = c.demo ? null : await realDb(c);
    const w = await loadWorld(c, db);
    const role = w.roles.find((r) => r.id === v.roleId);
    if (!role) return failResult("not_found", sa("roleNotFound"));
    if (role.isSystem) return denied(sa("systemRoleReadOnly"), sa("systemRoleReadOnlyWhy"));
    if (w.members.some((m) => m.roleId === role.id)) return failResult("invalid", sa("roleInUse"));
    if (c.demo || !db) return okResult(sa("roleDeleted", { name: role.name }), { sub: sa("demoNotice") });
    await S.deleteRole(db, c.tenant, role.id);
    return okResult(sa("roleDeleted", { name: role.name }));
  });
}

/** Explain access for a role (or the caller's own role) and one permission, with the engine's step trace. */
export async function explainAccess(input: unknown): Promise<Result<ExplainView>> {
  return act(async () => {
    const v = explainSchema.parse(input);
    const c = await adminCtx("members.manage");
    const db = c.demo ? null : await realDb(c);
    const w = await loadWorld(c, db);
    const role = v.roleId ? w.roles.find((r) => r.id === v.roleId) : undefined;
    if (v.roleId && !role) return failResult("not_found", sa("roleNotFound"));
    const p: Principal = role ? { ...c.principal, roleKey: role.key, grants: S.grantsOf(role), support: null } : c.principal;
    const e = explain(p, v.permission);
    const steps = e.steps.map((s) => ({ step: Number(s.step), name: s.name, passed: s.passed, detail: s.detail }));
    return okResult(sa("explained"), { data: { allow: e.decision.allow, reason: e.decision.reason, step: e.decision.step, steps } });
  });
}

// ---- teams ----
export async function createTeam(input: unknown): Promise<Result<{ id: string }>> {
  return act(async () => {
    const v = teamSchema.parse(input);
    const c = await adminCtx("teams.manage");
    if (c.demo) return okResult(sa("teamCreated", { name: v.name }), { sub: sa("demoNotice") });
    const db = await realDb(c);
    const id = await S.createTeam(db, c.ws, v.name, v.parentTeamId);
    return okResult(sa("teamCreated", { name: v.name }), { data: { id } });
  });
}
export async function updateTeam(input: unknown): Promise<Result> {
  return act(async () => {
    const v = updateTeamSchema.parse(input);
    const c = await adminCtx("teams.manage");
    if (v.parentTeamId === v.teamId) return failResult("invalid", sa("teamOwnParent"));
    if (c.demo) return okResult(sa("teamSaved", { name: v.name }), { sub: sa("demoNotice") });
    await S.updateTeam(await realDb(c), c.ws, v.teamId, v.name, v.parentTeamId);
    return okResult(sa("teamSaved", { name: v.name }));
  });
}
export async function deleteTeam(input: unknown): Promise<Result> {
  return act(async () => {
    const v = deleteTeamSchema.parse(input);
    const c = await adminCtx("teams.manage");
    if (c.demo) return okResult(sa("teamDeleted"), { sub: sa("demoNotice") });
    await S.deleteTeam(await realDb(c), c.ws, v.teamId);
    return okResult(sa("teamDeleted"));
  });
}
export async function setTeamMember(input: unknown): Promise<Result> {
  return act(async () => {
    const v = teamMemberSchema.parse(input);
    const c = await adminCtx("teams.manage");
    // Team manager widens `team` scope over the team's records: you cannot make yourself one (owners excepted).
    if (v.isManager && v.userId === c.uid && c.actor.baseRole !== "owner") return denied(sa("deny_self_change"));
    if (c.demo) return okResult(sa("teamMemberSaved"), { sub: sa("demoNotice") });
    const db = await realDb(c);
    if (!(await S.teamInWorkspace(db, c.ws, v.teamId))) return failResult("not_found", sa("teamNotFound"));
    const members = await S.loadMembers(db, c.ws);
    if (!members.some((m) => m.userId === v.userId && m.isActive)) return failResult("not_found", sa("memberNotFound"));
    await S.upsertTeamMember(db, v.teamId, v.userId, v.isManager);
    return okResult(sa("teamMemberSaved"));
  });
}
export async function removeTeamMember(input: unknown): Promise<Result> {
  return act(async () => {
    const v = removeTeamMemberSchema.parse(input);
    const c = await adminCtx("teams.manage");
    if (c.demo) return okResult(sa("teamMemberRemoved"), { sub: sa("demoNotice") });
    const db = await realDb(c);
    if (!(await S.teamInWorkspace(db, c.ws, v.teamId))) return failResult("not_found", sa("teamNotFound"));
    await S.removeTeamMember(db, v.teamId, v.userId);
    return okResult(sa("teamMemberRemoved"));
  });
}
