// Demo-mode grants for the six system roles, generated from the legacy page matrix and action table by the seed rule
// in CONTRACTS C3.1. TEMPORARY HOME: T001 owns catalog/system-roles.ts (the SQL seed source). When that file lands,
// swap `systemGrants` to read it; this module's tests pin the legacy behaviour either way.
import type { Role } from "../data/types";
import type { Grant, Scope } from "./types";
import { PAGE_PERMISSION } from "./pages";

export type Letter = "F" | "E" | "R" | "M";
const ROLE_ORDER: Role[] = ["owner", "sales_manager", "sales_rep", "marketing", "data", "viewer"];
const row = (...l: (Letter | null)[]) => Object.fromEntries(ROLE_ORDER.map((r, i) => [r, l[i]])) as Record<Role, Letter | null>;

/** Seed page matrix (owner, manager, rep, marketing, data, viewer). F full, E own, R read, M masked. */
export const SEED_PAGE_ACCESS: Record<string, Record<Role, Letter | null>> = {
  "/": row("F", "R", null, null, null, "M"),
  "/sales": row("R", "R", "E", null, null, null),
  "/leads": row("F", "F", "E", "R", "R", "M"),
  "/pipeline": row("F", "F", "E", "R", "R", "M"),
  "/accounts": row("F", "F", "R", "R", "F", "M"),
  "/campaigns": row("F", "R", null, "F", "R", "M"),
  "/audience": row("F", "R", null, "F", "F", "M"),
  "/analytics": row("F", "R", null, "F", "R", "M"),
  "/inbox": row("F", "F", "E", "R", null, null),
  "/tasks": row("F", "F", "E", "E", "E", null),
  "/ai": row("F", "E", "R", "R", "R", null),
  "/integrations": row("F", "R", null, "R", "E", null),
  "/data-health": row("F", "R", null, null, "F", null),
  "/settings": row("F", "E", null, null, "R", null),
};
/** Extra read permissions that follow a page, and its write permissions (first = primary, decides F vs R). */
export const PAGE_READS: Record<string, string[]> = {
  "/leads": ["activities.read"], "/accounts": ["contacts.read"],
};
export const PAGE_WRITES: Record<string, string[]> = {
  "/": ["config.edit"], "/sales": [], "/leads": ["leads.write", "leads.create", "activities.write"], "/pipeline": ["deals.write"],
  "/accounts": ["accounts.write", "contacts.write"], "/campaigns": ["campaigns.write"], "/audience": ["segments.write"],
  "/analytics": ["analytics.write"], "/inbox": ["inbox.reply"], "/tasks": ["tasks.write"], "/ai": ["ai.toggle"],
  "/integrations": ["integrations.manage"], "/data-health": ["data_health.manage"], "/settings": ["org.admin"],
};
/** Legacy action keys to permission keys, and which roles hold each at `all`. */
export const ACTION_PERMISSION = {
  assignLeads: "leads.assign", workLeads: "leads.write", moveDeals: "deals.move", importCsv: "leads.import", exportCsv: "leads.export",
  editCampaigns: "campaigns.write", branding: "org.branding", manageUsers: "members.manage", connectIntegrations: "integrations.manage",
  seePersonalData: "pii.read", createWorkspace: "org.admin", editSegments: "segments.write", editPipeline: "pipelines.manage",
  runHealthCheck: "data_health.manage", editAlertRules: "backups.manage", erase: "privacy.fulfil", aiToggle: "ai.toggle", privacyRequests: "privacy.fulfil",
} as const;
export type LegacyAction = keyof typeof ACTION_PERMISSION;
const OM: Role[] = ["owner", "sales_manager"];
export const SEED_ACTION_ROLES: Record<LegacyAction, Role[]> = {
  assignLeads: OM, workLeads: [...OM, "sales_rep"], moveDeals: [...OM, "sales_rep"], importCsv: ["owner", "marketing", "data"],
  exportCsv: ["owner", "data"], editCampaigns: ["owner", "marketing"], branding: ["owner"], manageUsers: OM, connectIntegrations: ["owner"],
  seePersonalData: ROLE_ORDER.filter((r) => r !== "viewer"), createWorkspace: ["owner"], editSegments: ["owner", "marketing", "data"],
  editPipeline: OM, runHealthCheck: ["owner", "data"], editAlertRules: ["owner"], erase: ["owner"], aiToggle: ["owner"], privacyRequests: ["owner"],
};

const RANK: Record<Scope, number> = { none: 0, own: 1, team: 2, all: 3 };
const put = (g: Record<string, Grant>, key: string, g1: Grant) => { if (!g[key] || RANK[g1.scope] > RANK[g[key].scope]) g[key] = { ...g[key], ...g1 }; };

const cache = new Map<Role, Record<string, Grant>>();
/** Grants for a system role: pages by letter, then actions at `all`, then pii.read. */
export function systemGrants(role: Role): Record<string, Grant> {
  const hit = cache.get(role);
  if (hit) return hit;
  const g: Record<string, Grant> = {};
  for (const [page, byRole] of Object.entries(SEED_PAGE_ACCESS)) {
    const letter = byRole[role];
    if (!letter) continue;
    const reads = [PAGE_PERMISSION[page], ...(PAGE_READS[page] ?? [])];
    if (letter === "E") {
      for (const k of reads) put(g, k, { scope: "own", ...(page === "/leads" && k === "leads.read" ? { territory: true } : {}) });
      for (const k of PAGE_WRITES[page]) put(g, k, { scope: "own" });
    } else {
      for (const k of reads) put(g, k, { scope: "all" });
      if (letter === "F") for (const k of PAGE_WRITES[page]) put(g, k, { scope: "all" });
    }
  }
  for (const [action, perm] of Object.entries(ACTION_PERMISSION)) if (SEED_ACTION_ROLES[action as LegacyAction].includes(role)) put(g, perm, { scope: "all" });
  cache.set(role, g);
  return g;
}

/** Letter for a page, derived back from the grants (inverse of the seed rule). */
export function derivedLetter(role: Role, page: string): Letter | null {
  const g = systemGrants(role), read = g[PAGE_PERMISSION[page]];
  if (!read || read.scope === "none") return null;
  if (read.scope === "own") return "E";
  const primary = PAGE_WRITES[page][0];
  if (primary && g[primary]?.scope === "all") return "F";
  return g["pii.read"]?.scope === "all" ? "R" : "M";
}
