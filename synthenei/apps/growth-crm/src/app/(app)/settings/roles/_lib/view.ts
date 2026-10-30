// Server-side loader for /settings/roles and the Members section: one view model for demo and real sessions.
// Each section loads independently so one failing query shows a partial state instead of a blank page.
import { requireActive } from "@/lib/auth/server";
import { loadPrincipal } from "@/lib/authz/load";
import { can } from "@/lib/authz/engine";
import { dbForRequest, type Db } from "@/lib/db/client";
import { throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import type { Scope } from "@/lib/authz/types";
import { heldOf } from "./ctx";
import type { BaseRole } from "./guards";
import { demoMembers, demoRoles } from "./ops";
import { activeOwnerCount, loadMembers, loadPolicy, loadRoles, loadTeams, type MemberRecord, type Policy, type RoleRecord, type TeamRecord } from "./store";

export interface HeldView { scope: Scope; conditions?: unknown; fieldMask?: string[] }
export interface AccessData {
  demo: boolean; wsName: string; tenantName: string; uid: string; baseRole: BaseRole;
  perms: { members: boolean; invite: boolean; roles: boolean; teams: boolean };
  members: MemberRecord[]; roles: RoleRecord[]; teams: TeamRecord[]; policy: Policy; activeOwners: number;
  held: Record<string, HeldView>;
}
export type AccessResult =
  | { status: "ok"; data: AccessData; failed: string[] }
  | { status: "denied"; reason: "support" | "role"; roleLabel: string }
  | { status: "error" };

export async function loadAccess(): Promise<AccessResult> {
  const { session, active } = await requireActive();
  const demo = session.demo === true;
  if (active.support) return { status: "denied", reason: "support", roleLabel: active.role };
  const p = await loadPrincipal();
  const held = heldOf(p, demo, active.role);
  // Demo fixture roles only know members.manage; real roles carry the finer keys.
  const perms = demo
    ? { members: can(p, "members.manage"), invite: can(p, "members.manage"), roles: active.role === "owner", teams: can(p, "members.manage") }
    : { members: can(p, "members.manage"), invite: can(p, "members.invite"), roles: can(p, "roles.manage"), teams: can(p, "teams.manage") };
  if (!perms.members && !perms.invite && !perms.roles && !perms.teams) return { status: "denied", reason: "role", roleLabel: active.role };
  const heldView = Object.fromEntries(Object.entries(held).map(([k, g]) => [k, { scope: g.scope, conditions: g.conditions, fieldMask: g.fieldMask }]));
  const base = { demo, wsName: active.ws.name, tenantName: active.tenant.name, uid: session.uid, baseRole: active.role as BaseRole, perms, held: heldView };
  if (demo) {
    const members = demoMembers(active.ws.id);
    return { status: "ok", failed: [], data: { ...base, members, roles: demoRoles(), teams: [], policy: { allowCustomRoles: true, maxSeats: null }, activeOwners: activeOwnerCount(members) } };
  }
  try {
    const db: Db = await dbForRequest();
    const w = await from(db, "workspaces").select("tenant_id").eq("id", active.ws.uuid).maybeSingle();
    throwIfError(w.error);
    const tenant = String((w.data as { tenant_id?: string } | null)?.tenant_id ?? "");
    if (!tenant) return { status: "error" };
    const failed: string[] = [];
    const part = async <T,>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn(); } catch (e) { console.error(`[settings/roles] ${name}`, e); failed.push(name); return fallback; } };
    const [members, roles, teams, policy] = await Promise.all([
      part("members", () => loadMembers(db, active.ws.uuid), [] as MemberRecord[]),
      part("roles", () => loadRoles(db, tenant), [] as RoleRecord[]),
      part("teams", () => loadTeams(db, active.ws.uuid), [] as TeamRecord[]),
      part("policy", () => loadPolicy(db, tenant), { allowCustomRoles: true, maxSeats: null } as Policy),
    ]);
    if (failed.length === 4) return { status: "error" };
    return { status: "ok", failed, data: { ...base, members, roles, teams, policy, activeOwners: activeOwnerCount(members) } };
  } catch (e) {
    console.error("[settings/roles] load", e);
    return { status: "error" };
  }
}
