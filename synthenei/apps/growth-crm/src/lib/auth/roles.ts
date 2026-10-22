// Roles, demo users and the page-access matrix (spec 03-product-spec.md section 10.2).
// Shared by middleware (edge), server components and client components: keep it dependency-free.
import type { Role } from "../data/types";

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
const A = (o: Access | null, m: Access | null, r: Access | null, k: Access | null, d: Access | null, v: Access | null) =>
  ({ owner: o, sales_manager: m, sales_rep: r, marketing: k, data: d, viewer: v }) as Record<Role, Access | null>;
export const PAGE_ACCESS: Record<string, Record<Role, Access | null>> = {
  "/": A("F", "R", null, null, null, "M"),
  "/sales": A("R", "R", "E", null, null, null),
  "/leads": A("F", "F", "E", "R", "R", "M"),
  "/pipeline": A("F", "F", "E", "R", "R", "M"),
  "/accounts": A("F", "F", "R", "R", "F", "M"),
  "/campaigns": A("F", "R", null, "F", "R", "M"),
  "/audience": A("F", "R", null, "F", "F", "M"),
  "/analytics": A("F", "R", null, "F", "R", "M"),
  "/inbox": A("F", "F", "E", "R", null, null),
  "/tasks": A("F", "F", "E", "E", "E", null),
  "/ai": A("F", "E", "R", "R", "R", null),
  "/integrations": A("F", "R", null, "R", "E", null),
  "/data-health": A("F", "R", null, null, "F", null),
  "/settings": A("F", "E", null, null, "R", null),
};
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

/** Action permissions (spec 10.3). */
export const CAN = {
  assignLeads: (r: Role) => r === "owner" || r === "sales_manager",
  workLeads: (r: Role) => r === "owner" || r === "sales_manager" || r === "sales_rep",
  moveDeals: (r: Role) => r === "owner" || r === "sales_manager" || r === "sales_rep",
  importCsv: (r: Role) => r === "owner" || r === "marketing" || r === "data",
  exportCsv: (r: Role) => r === "owner" || r === "data",
  editCampaigns: (r: Role) => r === "owner" || r === "marketing",
  branding: (r: Role) => r === "owner",
  manageUsers: (r: Role) => r === "owner" || r === "sales_manager",
  connectIntegrations: (r: Role) => r === "owner",
  seePersonalData: (r: Role) => r !== "viewer",
  createWorkspace: (r: Role) => r === "owner",
  editSegments: (r: Role) => r === "owner" || r === "marketing" || r === "data",
  editPipeline: (r: Role) => r === "owner" || r === "sales_manager",
  runHealthCheck: (r: Role) => r === "owner" || r === "data",
  editAlertRules: (r: Role) => r === "owner",
  erase: (r: Role) => r === "owner",
  aiToggle: (r: Role) => r === "owner",
  privacyRequests: (r: Role) => r === "owner",
};
/** Disabled during any support session regardless of role (spec 10.5). */
export const SUPPORT_BLOCKED = ["exportCsv", "branding", "connectIntegrations", "erase", "aiToggle", "createWorkspace", "manageUsers", "privacyRequests"] as const;
export type Action = keyof typeof CAN;
/** The one permission check: role from the workspace membership, then support-session restrictions on top. */
export function can(action: Action, ctx: { role: Role; support?: { mode: "read_only" | "read_write" } | null }): boolean {
  if (ctx.support) {
    if (ctx.support.mode === "read_only") return false;
    if ((SUPPORT_BLOCKED as readonly string[]).includes(action)) return false;
  }
  return CAN[action](ctx.role);
}
/** Settings tabs per role (spec 10.2). */
export const SETTINGS_TABS: Record<Role, string[]> = {
  owner: ["users", "config", "pipeline", "privacy", "audit"],
  sales_manager: ["users", "pipeline", "privacy", "audit"],
  data: ["privacy"],
  sales_rep: [], marketing: [], viewer: [],
};
