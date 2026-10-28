// Page and module maps (CONTRACTS C3.2). Pure data.
export const PAGE_PERMISSION: Record<string, string> = {
  "/": "dashboard.read", "/sales": "myday.read", "/leads": "leads.read", "/pipeline": "deals.read", "/accounts": "accounts.read",
  "/contacts": "contacts.read", "/campaigns": "campaigns.read", "/audience": "segments.read", "/analytics": "analytics.read",
  "/inbox": "inbox.read", "/tasks": "tasks.read", "/ai": "ai.use", "/integrations": "integrations.read",
  "/data-health": "data_health.read", "/settings": "settings.read",
};
export const ALWAYS_ALLOWED_PAGES = ["/notifications", "/profile", "/forbidden", "/onboarding"];

/** Permission required to open a page, `null` = always allowed, `undefined` = unknown page (default deny). */
export function pagePermission(pathname: string): string | null | undefined {
  if (ALWAYS_ALLOWED_PAGES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return null;
  const om = /^\/o\/([a-z0-9_-]+)/.exec(pathname);
  if (om) return `obj:${om[1]}.read`;
  if (pathname === "/") return PAGE_PERMISSION["/"];
  const key = Object.keys(PAGE_PERMISSION).filter((k) => k !== "/" && (pathname === k || pathname.startsWith(k + "/"))).sort((a, b) => b.length - a.length)[0];
  return key ? PAGE_PERMISSION[key] : undefined;
}

/** Tenant module (config MODULE_IDS) that gates a permission resource. Resources not listed are not module-gated. */
export const MODULE_OF_RESOURCE: Record<string, string> = {
  inbox: "inbox", messages: "inbox", ai: "ai", integrations: "integrations", webhooks: "integrations", api_keys: "integrations",
  segments: "audience", audience: "audience", analytics: "analytics", tasks: "tasks", accounts: "accounts", contacts: "accounts",
  campaigns: "campaigns", data_health: "data-health",
};
export const moduleOfPermission = (perm: string): string | undefined => MODULE_OF_RESOURCE[perm.slice(0, perm.lastIndexOf("."))];
