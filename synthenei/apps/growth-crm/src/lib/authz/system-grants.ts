// System-role grants for the TypeScript engine. SINGLE SOURCE: catalog/system-roles.ts (the same data the SQL seed in
// 0013 + 0016 + 0019 + 0033 is parity-tested against, see __tests__/sql-parity.test.ts). Nothing here is derived from a
// second rule table any more (AUD-115): the old page-matrix derivation gave roles grants SQL never seeded.
import type { Role } from "../data/types";
import type { Grant, Scope } from "./types";
import { PAGE_ACCESS_SEED, SYSTEM_ROLES } from "./catalog/system-roles";

export type Letter = "F" | "E" | "R" | "M";

/** Stored page matrix (owner, manager, rep, marketing, data, viewer). F full, E own, R read, M masked. */
export const SEED_PAGE_ACCESS = PAGE_ACCESS_SEED as Record<string, Record<Role, Letter | null>>;

/** Legacy action keys to permission keys (CONTRACTS C3.1). A role "can" an action when it holds the key at any scope. */
export const ACTION_PERMISSION = {
  assignLeads: "leads.assign", workLeads: "leads.write", moveDeals: "deals.move", importCsv: "leads.import", exportCsv: "leads.export",
  editCampaigns: "campaigns.write", branding: "org.branding", manageUsers: "members.manage", connectIntegrations: "integrations.manage",
  seePersonalData: "pii.read", createWorkspace: "org.admin", editSegments: "segments.write", editPipeline: "pipelines.manage",
  runHealthCheck: "data_health.manage", editAlertRules: "backups.manage", erase: "privacy.fulfil", aiToggle: "ai.toggle", privacyRequests: "privacy.fulfil",
} as const;
export type LegacyAction = keyof typeof ACTION_PERMISSION;

const cache = new Map<Role, Record<string, Grant>>();
/**
 * Grants for a system role, exactly the role_permissions rows of the seed. Mirrors authz.my_grants (0016): the `territory`
 * flag is set on leads.read at scope own (reps also see unassigned leads in their districts).
 */
export function systemGrants(role: Role): Record<string, Grant> {
  const hit = cache.get(role);
  if (hit) return hit;
  const g: Record<string, Grant> = {};
  const seed = SYSTEM_ROLES.find((r) => r.key === role);
  for (const [key, scope] of Object.entries(seed?.grants ?? {})) {
    g[key] = { scope: scope as Scope, ...(key === "leads.read" && scope === "own" ? { territory: true } : {}) };
  }
  cache.set(role, g);
  return g;
}

/** Page letter, from the stored matrix. Its consistency with the grants is pinned by __tests__/sql-parity.test.ts. */
export function derivedLetter(role: Role, page: string): Letter | null {
  return SEED_PAGE_ACCESS[page]?.[role] ?? null;
}
