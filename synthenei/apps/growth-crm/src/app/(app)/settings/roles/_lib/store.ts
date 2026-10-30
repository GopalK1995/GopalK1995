// Data access for members, roles, teams and territories. Every function takes the request-scoped client so unit tests
// can pass the mocked client; RLS and the guard triggers of migration 0013 stay the second line of defence.
import type { Db } from "@/lib/db/client";
import { DbError, throwIfError } from "@/lib/db/errors";
import { from, type Qb, type QResult } from "@/lib/db/query";
import type { Grant, Scope } from "@/lib/authz/types";
import type { BaseRole, GrantInput } from "./guards";

interface Qw extends Qb {
  delete(): Qw;
  upsert(v: Record<string, unknown> | Record<string, unknown>[], o?: { onConflict?: string }): Qw;
}
const t = (db: Db, table: string): Qw => from(db, table) as Qw;
const rows = (r: QResult): Record<string, unknown>[] => {
  throwIfError(r.error);
  const d = r.data as Record<string, unknown>[] | Record<string, unknown> | null;
  return Array.isArray(d) ? d : d ? [d] : [];
};
const one = (r: QResult): Record<string, unknown> | null => rows(r)[0] ?? null;

export interface MemberRecord { userId: string; membershipId: string; name: string; email: string; baseRole: BaseRole; roleId: string | null; isActive: boolean; districts: string[]; regions: string[]; lastSeenAt: string | null }
export interface RoleRecord { id: string; key: string; name: string; description: string; baseRole: BaseRole; isSystem: boolean; tenantId: string | null; updatedAt: string; grants: GrantInput[] }
export interface TeamRecord { id: string; name: string; parentTeamId: string | null; members: { userId: string; isManager: boolean }[] }
export interface Policy { allowCustomRoles: boolean; maxSeats: number | null }

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function loadMembers(db: Db, ws: string): Promise<MemberRecord[]> {
  const ms = rows(await t(db, "memberships").select("id, user_id, role, role_id, is_active, attributes").eq("workspace_id", ws));
  const ids = ms.map((m) => String(m.user_id));
  const ps = ids.length ? rows(await t(db, "profiles").select("id, full_name, email, last_seen_at").in("id", ids)) : [];
  const byId = new Map(ps.map((p) => [String(p.id), p]));
  return ms.map((m) => {
    const p = byId.get(String(m.user_id));
    const a = (m.attributes ?? {}) as Record<string, unknown>;
    return {
      userId: String(m.user_id), membershipId: String(m.id), name: String(p?.full_name ?? p?.email ?? "Member"), email: String(p?.email ?? ""),
      baseRole: m.role as BaseRole, roleId: (m.role_id as string | null) ?? null, isActive: m.is_active !== false,
      districts: strArr(a.districts), regions: strArr(a.regions), lastSeenAt: (p?.last_seen_at as string | null) ?? null,
    };
  });
}
export const activeOwnerCount = (members: MemberRecord[]): number => members.filter((m) => m.isActive && m.baseRole === "owner").length;

export async function loadPolicy(db: Db, tenant: string): Promise<Policy> {
  const r = one(await t(db, "org_admin_policies").select("allow_custom_roles, max_seats").eq("tenant_id", tenant).maybeSingle());
  return { allowCustomRoles: r ? r.allow_custom_roles !== false : true, maxSeats: (r?.max_seats as number | null | undefined) ?? null };
}

function mapRole(r: Record<string, unknown>, perms: Record<string, unknown>[]): RoleRecord {
  return {
    id: String(r.id), key: String(r.key), name: String(r.name), description: String(r.description ?? ""), baseRole: r.base_role as BaseRole,
    isSystem: r.is_system === true, tenantId: (r.tenant_id as string | null) ?? null, updatedAt: String(r.updated_at ?? ""),
    grants: perms.filter((p) => p.role_id === r.id).map((p) => ({ permission: String(p.permission_key), scope: p.scope as Scope, conditions: p.conditions, fieldMask: strArr(p.field_mask) })),
  };
}
export async function loadRoles(db: Db, tenant: string): Promise<RoleRecord[]> {
  const rs = rows(await t(db, "roles").select().or(`tenant_id.is.null,tenant_id.eq.${tenant}`).order("name", { ascending: true }));
  const ids = rs.map((r) => String(r.id));
  const ps = ids.length ? rows(await t(db, "role_permissions").select().in("role_id", ids)) : [];
  return rs.map((r) => mapRole(r, ps));
}
/** A role the caller may see: a system template or one of this tenant. Anything else reads as missing. */
export async function loadRole(db: Db, tenant: string, id: string): Promise<RoleRecord | null> {
  const r = one(await t(db, "roles").select().eq("id", id).maybeSingle());
  if (!r || (r.tenant_id != null && r.tenant_id !== tenant)) return null;
  return mapRole(r, rows(await t(db, "role_permissions").select().eq("role_id", id)));
}

const permRow = (roleId: string, g: GrantInput) => ({ role_id: roleId, permission_key: g.permission, scope: g.scope, conditions: g.conditions ?? {}, field_mask: g.fieldMask ?? [] });
export async function createRole(db: Db, tenant: string, input: { key: string; name: string; description: string; baseRole: BaseRole; grants: GrantInput[] }): Promise<RoleRecord> {
  const r = one(await t(db, "roles").insert({ tenant_id: tenant, key: input.key, name: input.name, description: input.description, base_role: input.baseRole, is_system: false }).select().single());
  if (!r) throw new DbError("error", "error");
  const id = String(r.id);
  const g = input.grants.filter((x) => x.scope !== "none");
  try {
    if (g.length) throwIfError((await t(db, "role_permissions").insert(g.map((x) => permRow(id, x)))).error);
  } catch (e) {
    await t(db, "roles").delete().eq("id", id).eq("tenant_id", tenant); // compensate: no half-built role (an RPC would make this atomic)
    throw e;
  }
  return mapRole(r, g.map((x) => permRow(id, x)));
}
/** Optimistic update keyed on updated_at; zero rows means someone saved first (DbError conflict). */
export async function updateRole(db: Db, tenant: string, id: string, expectedUpdatedAt: string, input: { name: string; description: string; baseRole: BaseRole; grants: GrantInput[] }): Promise<void> {
  const upd = rows(await t(db, "roles").update({ name: input.name, description: input.description, base_role: input.baseRole }).eq("id", id).eq("tenant_id", tenant).eq("updated_at", expectedUpdatedAt).select("id"));
  if (!upd.length) {
    const cur = one(await t(db, "roles").select("id, updated_at").eq("id", id).maybeSingle());
    throw cur ? new DbError("conflict", "conflict", { current: { updatedAt: cur.updated_at } }) : new DbError("not_found", "not_found");
  }
  const keep = input.grants.filter((x) => x.scope !== "none");
  if (keep.length) throwIfError((await t(db, "role_permissions").upsert(keep.map((x) => permRow(id, x)), { onConflict: "role_id,permission_key" })).error);
  const existing = rows(await t(db, "role_permissions").select("permission_key").eq("role_id", id)).map((x) => String(x.permission_key));
  const toDelete = existing.filter((k) => !keep.some((x) => x.permission === k));
  if (toDelete.length) throwIfError((await t(db, "role_permissions").delete().eq("role_id", id).in("permission_key", toDelete)).error);
}
export async function deleteRole(db: Db, tenant: string, id: string): Promise<void> {
  const inUse = rows(await t(db, "memberships").select("id").eq("role_id", id).limit(1));
  if (inUse.length) throw new DbError("invalid", "invalid", { detail: "role_in_use" });
  throwIfError((await t(db, "roles").delete().eq("id", id).eq("tenant_id", tenant)).error);
}

export async function setMemberRole(db: Db, ws: string, userId: string, roleId: string): Promise<void> {
  const r = rows(await t(db, "memberships").update({ role_id: roleId }).eq("workspace_id", ws).eq("user_id", userId).select("id"));
  if (!r.length) throw new DbError("not_found", "not_found");
}
export async function setMemberActive(db: Db, ws: string, userId: string, active: boolean): Promise<void> {
  const r = rows(await t(db, "memberships").update({ is_active: active }).eq("workspace_id", ws).eq("user_id", userId).select("id"));
  if (!r.length) throw new DbError("not_found", "not_found");
}
export async function setMemberAttributes(db: Db, ws: string, userId: string, districts: string[], regions: string[]): Promise<void> {
  const m = one(await t(db, "memberships").select("id, attributes").eq("workspace_id", ws).eq("user_id", userId).maybeSingle());
  if (!m) throw new DbError("not_found", "not_found");
  const attrs = { ...((m.attributes ?? {}) as Record<string, unknown>), regions };
  throwIfError((await t(db, "memberships").update({ attributes: attrs }).eq("id", String(m.id))).error);
  // Districts live in territories (one rep per district per workspace); a trigger mirrors them into attributes.districts.
  const mine = rows(await t(db, "territories").select("district").eq("workspace_id", ws).eq("rep_id", userId)).map((x) => String(x.district));
  const gone = mine.filter((d) => !districts.includes(d));
  if (districts.length) throwIfError((await t(db, "territories").upsert(districts.map((d) => ({ workspace_id: ws, district: d, rep_id: userId })), { onConflict: "workspace_id,district" })).error);
  if (gone.length) throwIfError((await t(db, "territories").delete().eq("workspace_id", ws).eq("rep_id", userId).in("district", gone)).error);
}

export async function loadTeams(db: Db, ws: string): Promise<TeamRecord[]> {
  const ts = rows(await t(db, "teams").select().eq("workspace_id", ws).order("name", { ascending: true }));
  const ids = ts.map((x) => String(x.id));
  const ms = ids.length ? rows(await t(db, "team_members").select().in("team_id", ids)) : [];
  return ts.map((x) => ({
    id: String(x.id), name: String(x.name), parentTeamId: (x.parent_team_id as string | null) ?? null,
    members: ms.filter((m) => m.team_id === x.id).map((m) => ({ userId: String(m.user_id), isManager: m.is_manager === true })),
  }));
}
export async function createTeam(db: Db, ws: string, name: string, parentTeamId: string | null): Promise<string> {
  const r = one(await t(db, "teams").insert({ workspace_id: ws, name, parent_team_id: parentTeamId }).select("id").single());
  if (!r) throw new DbError("error", "error");
  return String(r.id);
}
export async function updateTeam(db: Db, ws: string, id: string, name: string, parentTeamId: string | null): Promise<void> {
  const r = rows(await t(db, "teams").update({ name, parent_team_id: parentTeamId }).eq("id", id).eq("workspace_id", ws).select("id"));
  if (!r.length) throw new DbError("not_found", "not_found");
}
export async function deleteTeam(db: Db, ws: string, id: string): Promise<void> {
  throwIfError((await t(db, "teams").delete().eq("id", id).eq("workspace_id", ws)).error);
}
/** The team must belong to this workspace; the member guard trigger also checks membership of that workspace. */
export async function teamInWorkspace(db: Db, ws: string, teamId: string): Promise<boolean> {
  return !!one(await t(db, "teams").select("id").eq("id", teamId).eq("workspace_id", ws).maybeSingle());
}
export async function upsertTeamMember(db: Db, teamId: string, userId: string, isManager: boolean): Promise<void> {
  throwIfError((await t(db, "team_members").upsert({ team_id: teamId, user_id: userId, is_manager: isManager }, { onConflict: "team_id,user_id" })).error);
}
export async function removeTeamMember(db: Db, teamId: string, userId: string): Promise<void> {
  throwIfError((await t(db, "team_members").delete().eq("team_id", teamId).eq("user_id", userId)).error);
}

export const grantsOf = (r: Pick<RoleRecord, "grants">): Record<string, Grant> =>
  Object.fromEntries(r.grants.filter((g) => g.scope !== "none").map((g) => [g.permission, { scope: g.scope, conditions: g.conditions, fieldMask: g.fieldMask } as Grant]));
