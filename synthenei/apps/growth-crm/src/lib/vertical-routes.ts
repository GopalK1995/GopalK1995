// Module keys and their route prefixes, kept apart from vertical.ts (95 kB with the tenant presets) so the edge middleware does not bundle the presets (AUD-038).
export type ModuleKey = "inbox" | "ai" | "integrations" | "audience" | "analytics" | "tasks" | "accounts" | "campaigns" | "data-health";
export const MODULE_KEYS: ModuleKey[] = ["inbox", "ai", "integrations", "audience", "analytics", "tasks", "accounts", "campaigns", "data-health"];
/** Route prefix -> module. A disabled module hides its nav entry and 403s its route (middleware). */
export const MODULE_ROUTE: Record<string, ModuleKey> = { "/inbox": "inbox", "/ai": "ai", "/integrations": "integrations", "/audience": "audience", "/analytics": "analytics", "/tasks": "tasks", "/accounts": "accounts", "/campaigns": "campaigns", "/data-health": "data-health" };
export const moduleForPath = (pathname: string): ModuleKey | undefined => { const k = Object.keys(MODULE_ROUTE).find((r) => pathname === r || pathname.startsWith(r + "/")); return k ? MODULE_ROUTE[k] : undefined; };
