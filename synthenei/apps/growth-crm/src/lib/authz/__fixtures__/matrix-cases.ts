// Builds the decision matrix shared with SQL (T057 runs __fixtures__/matrix.json against authz.check/explain).
// personas/records/tenants are symbolic so the SQL side can map them onto seeded rows.
import { PERMISSIONS } from "../catalog";
import { decide } from "../engine";
import { systemPrincipal } from "../principal";
import type { Principal, RecordRef } from "../types";
import type { Role } from "../../data/types";

export const ROLES6: Role[] = ["owner", "sales_manager", "sales_rep", "marketing", "data", "viewer"];
export const SUPPORT = ["none", "read_only", "read_write"] as const;
export const NOW = "2026-10-28T06:00:00.000Z";
const ME = "@me";
export const RECORDS: Record<string, Omit<RecordRef, "workspaceId"> & { workspaceId: string }> = {
  none: null as never,
  own: { type: "lead", workspaceId: "ws1", ownerId: ME },
  assigned: { type: "lead", workspaceId: "ws1", ownerId: "u-other", assigneeId: ME },
  team: { type: "lead", workspaceId: "ws1", ownerId: "u-sales_rep" },
  other: { type: "lead", workspaceId: "ws1", ownerId: "u-other" },
  unowned_in_district: { type: "lead", workspaceId: "ws1", ownerId: null, attrs: { district: "Madurai" } },
  unowned_far: { type: "lead", workspaceId: "ws1", ownerId: null, attrs: { district: "Chennai" } },
  shared_viewer: { type: "lead", workspaceId: "ws1", ownerId: "u-other", sharedWith: [{ relation: "viewer", subjectType: "user", subjectId: ME }] },
  shared_editor: { type: "lead", workspaceId: "ws1", ownerId: "u-other", sharedWith: [{ relation: "editor", subjectType: "user", subjectId: ME }] },
  foreign_ws: { type: "lead", workspaceId: "ws2", ownerId: ME },
};
export const TENANTS = { active: { status: "active" }, suspended: { status: "suspended" }, trial_expired: { status: "trial", trialEndsAt: "2026-10-01T00:00:00.000Z" } } as const;
const DEEP_PERMS = ["leads.read", "leads.write", "deals.move", "tasks.write", "accounts.read", "inbox.reply", "campaigns.write", "pii.read"];

export function persona(role: Role, support: (typeof SUPPORT)[number], tenant: keyof typeof TENANTS = "active", modulesOff: string[] = []): Principal {
  return systemPrincipal({
    uid: `u-${role}`, workspaceId: "ws1", role, tenantId: "t1", tenant: TENANTS[tenant] as Principal["tenant"], modulesOff,
    support: support === "none" ? null : { mode: support },
    attrs: role === "sales_rep" ? { districts: ["Madurai"] } : {},
    teamUserIds: role === "sales_manager" ? ["u-sales_manager", "u-sales_rep"] : [`u-${role}`],
  });
}
export function recordFor(key: string, uid: string): RecordRef | undefined {
  const r = RECORDS[key];
  if (!r) return undefined;
  const sub = (v: unknown): unknown => (v === ME ? uid : v);
  return { ...r, ownerId: sub(r.ownerId) as string | null | undefined, assigneeId: sub(r.assigneeId) as string | undefined,
    sharedWith: r.sharedWith?.map((s) => ({ ...s, subjectId: sub(s.subjectId) as string })) };
}

/** [role, support, tenant, modulesOff, perm, record, allow, reason, step] */
export type Row = [Role, string, string, string, string, string, boolean, string | null, number];
export function buildMatrix(): Row[] {
  const rows: Row[] = [];
  const add = (role: Role, support: (typeof SUPPORT)[number], tenant: keyof typeof TENANTS, off: string[], perm: string, rec: string) => {
    const p = persona(role, support, tenant, off), d = decide(p, perm, recordFor(rec, p.uid), new Date(NOW));
    rows.push([role, support, tenant, off.join(","), perm, rec, d.allow, d.reason, d.step]);
  };
  for (const role of ROLES6) for (const s of SUPPORT) for (const { key } of PERMISSIONS) for (const rec of ["none", "own", "other"]) add(role, s, "active", [], key, rec);
  for (const role of ROLES6) for (const s of SUPPORT) for (const perm of DEEP_PERMS) for (const rec of Object.keys(RECORDS)) add(role, s, "active", [], perm, rec);
  for (const role of ROLES6) for (const t of ["suspended", "trial_expired"] as const) for (const perm of ["leads.read", "leads.write", "settings.read"]) add(role, "none", t, [], perm, "own");
  for (const role of ROLES6) for (const [perm, mod] of [["inbox.read", "inbox"], ["campaigns.write", "campaigns"], ["ai.use", "ai"]] as const) add(role, "none", "active", [mod], perm, "none");
  return rows;
}
