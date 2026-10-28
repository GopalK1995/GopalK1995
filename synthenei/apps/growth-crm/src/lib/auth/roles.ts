// Roles, demo users and the page-access matrix (spec 03-product-spec.md section 10.2).
// Shared by middleware (edge), server components and client components: keep it dependency-free.
import type { Role } from "../data/types";
import { decide } from "../authz/engine";
import { systemPrincipal } from "../authz/principal";
import { ACTION_PERMISSION, SEED_PAGE_ACCESS, derivedLetter, systemGrants, type LegacyAction } from "../authz/system-grants";

export const ROLES: Role[] = ["owner", "sales_manager", "sales_rep", "marketing", "data", "viewer"];
export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", sales_manager: "Sales Manager", sales_rep: "Sales Rep", marketing: "Marketing", data: "Data", viewer: "Viewer" };
export const ROLE_BLURB: Record<Role, string> = {
  owner: "Revenue, pipeline, team and branding. Full access.",
  sales_manager: "Team pipeline, assignment, targets and SLAs.",
  sales_rep: "Own leads, demos and follow-ups for the day.",
  marketing: "Campaigns, audience, web analytics and attribution.",
  data: "Imports, integrations, sync health and backups.",
  viewer: "Read-only dashboards, no personal data.",
};

/** F full · E own/assigned · R read · M masked/aggregates. Missing = no access. */
export type Access = "F" | "E" | "R" | "M";
/** Derived view of the system-role grants (authz/system-grants), kept for demo mode and existing call sites. */
export const PAGE_ACCESS: Record<string, Record<Role, Access | null>> = Object.fromEntries(
  Object.keys(SEED_PAGE_ACCESS).map((page) => [page, Object.fromEntries(ROLES.map((r) => [r, derivedLetter(r, page)])) as Record<Role, Access | null>]),
);
export const HOME_FOR: Record<Role, string> = { owner: "/", sales_manager: "/", viewer: "/", sales_rep: "/sales", marketing: "/campaigns", data: "/data-health" };

const OPEN_PATHS = ["/forbidden", "/profile", "/no-workspace"];
/** Default deny: a path that is not in the matrix is not reachable. */
export function accessFor(role: Role, pathname: string): Access | null {
  if (OPEN_PATHS.includes(pathname)) return "F";
  if (pathname === "/") return PAGE_ACCESS["/"][role];
  const key = Object.keys(PAGE_ACCESS).filter((k) => k !== "/" && (pathname === k || pathname.startsWith(k + "/"))).sort((a, b) => b.length - a.length)[0];
  return key ? PAGE_ACCESS[key][role] : null;
}
export const canEdit = (a: Access | null) => a === "F" || a === "E";

/** Action permissions (spec 10.3), derived from the system-role grants: true when the role holds the key at scope all. */
export const CAN = Object.fromEntries(
  (Object.keys(ACTION_PERMISSION) as LegacyAction[]).map((a) => [a, (r: Role) => systemGrants(r)[ACTION_PERMISSION[a]]?.scope === "all"]),
) as Record<LegacyAction, (r: Role) => boolean>;
/** Disabled during any support session regardless of role (spec 10.5). Literal tuple for typing; a unit test pins it to the catalogue's supportBlocked flags. */
export const SUPPORT_BLOCKED = ["exportCsv", "branding", "connectIntegrations", "erase", "aiToggle", "createWorkspace", "manageUsers", "privacyRequests"] as const;
export type Action = keyof typeof CAN;
/** The one permission check: evaluated by the authz engine on the role's system grants, support overlay included. */
export function can(action: Action, ctx: { role: Role; support?: { mode: "read_only" | "read_write" } | null }): boolean {
  const perm = ACTION_PERMISSION[action], p = systemPrincipal({ uid: "legacy", workspaceId: "legacy", role: ctx.role, support: ctx.support ?? null, overlay: false });
  // Legacy actions are unrestricted capabilities: an own-scope grant (page-level edit of own records) does not satisfy them.
  return decide(p, perm).allow && p.grants[perm]?.scope === "all";
}
/** Settings tabs per role (spec 10.2). */
export const SETTINGS_TABS: Record<Role, string[]> = {
  owner: ["users", "config", "pipeline", "privacy", "audit"],
  sales_manager: ["users", "pipeline", "privacy", "audit"],
  data: ["privacy"],
  sales_rep: [], marketing: [], viewer: [],
};
