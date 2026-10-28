// Frozen copy of PAGE_ACCESS, CAN and SUPPORT_BLOCKED from src/lib/auth/roles.ts at c2d562f. Do not edit.
import type { Role } from "../../data/types";
type L = "F" | "E" | "R" | "M";
const A = (o: L | null, m: L | null, r: L | null, k: L | null, d: L | null, v: L | null) => ({ owner: o, sales_manager: m, sales_rep: r, marketing: k, data: d, viewer: v }) as Record<Role, L | null>;
export const LEGACY_PAGE_ACCESS: Record<string, Record<Role, L | null>> = {
  "/": A("F", "R", null, null, null, "M"), "/sales": A("R", "R", "E", null, null, null), "/leads": A("F", "F", "E", "R", "R", "M"),
  "/pipeline": A("F", "F", "E", "R", "R", "M"), "/accounts": A("F", "F", "R", "R", "F", "M"), "/campaigns": A("F", "R", null, "F", "R", "M"),
  "/audience": A("F", "R", null, "F", "F", "M"), "/analytics": A("F", "R", null, "F", "R", "M"), "/inbox": A("F", "F", "E", "R", null, null),
  "/tasks": A("F", "F", "E", "E", "E", null), "/ai": A("F", "E", "R", "R", "R", null), "/integrations": A("F", "R", null, "R", "E", null),
  "/data-health": A("F", "R", null, null, "F", null), "/settings": A("F", "E", null, null, "R", null),
};
export const LEGACY_CAN = {
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
export const LEGACY_SUPPORT_BLOCKED = ["exportCsv", "branding", "connectIntegrations", "erase", "aiToggle", "createWorkspace", "manageUsers", "privacyRequests"];
export function legacyCan(action: keyof typeof LEGACY_CAN, ctx: { role: Role; support?: { mode: "read_only" | "read_write" } | null }): boolean {
  if (ctx.support) {
    if (ctx.support.mode === "read_only") return false;
    if (LEGACY_SUPPORT_BLOCKED.includes(action)) return false;
  }
  return LEGACY_CAN[action](ctx.role);
}
