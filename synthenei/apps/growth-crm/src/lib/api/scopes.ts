// API scopes and their mapping onto authz permissions (CONTRACTS C11: effective permission = role grant AND scope).
// A scope never grants anything by itself: it only narrows. The permission matrix (src/lib/authz) still decides.

export const SCOPE_RESOURCES = ["leads", "contacts", "accounts", "deals", "tasks", "activities", "campaigns", "records", "pipelines", "fields", "webhooks"] as const;
export type ScopeResource = (typeof SCOPE_RESOURCES)[number];
export type ScopeAction = "read" | "write";
/** What a route does. `write` scopes cover create, update, delete and move. */
export type ApiAction = "read" | "create" | "update" | "delete" | "move";

/** Resources that are read-only over the API (no `:write` scope is offered). */
const READ_ONLY: ScopeResource[] = ["campaigns", "pipelines", "fields"];

export const ALL_SCOPES: string[] = SCOPE_RESOURCES.flatMap((r) => (READ_ONLY.includes(r) ? [`${r}:read`] : [`${r}:read`, `${r}:write`]));

const OBJ_KEY = /^[a-z][a-z0-9_]{1,40}$/;
export const isObjectKey = (k: string): boolean => OBJ_KEY.test(k);

export function isValidScope(s: string): boolean {
  return ALL_SCOPES.includes(s);
}
export function normalizeScopes(list: readonly string[]): string[] {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))].sort();
}
export function invalidScopes(list: readonly string[]): string[] {
  return list.filter((s) => !isValidScope(s));
}

/** The authz permission a route needs. `objectKey` is required for `records`. Returns null for a combination that does not exist. */
export function permissionFor(resource: ScopeResource, action: ApiAction, objectKey?: string): string | null {
  switch (resource) {
    case "records": {
      if (!objectKey || !isObjectKey(objectKey)) return null;
      return `obj:${objectKey}.${action === "read" ? "read" : action === "delete" ? "delete" : "write"}`;
    }
    case "leads": return action === "read" ? "leads.read" : action === "create" ? "leads.create" : action === "delete" ? "leads.delete" : "leads.write";
    case "contacts": return action === "read" ? "contacts.read" : action === "delete" ? "contacts.delete" : "contacts.write";
    case "accounts": return action === "read" ? "accounts.read" : action === "delete" ? "accounts.delete" : "accounts.write";
    case "deals": return action === "read" ? "deals.read" : action === "delete" ? "deals.delete" : action === "move" ? "deals.move" : "deals.write";
    case "tasks": return action === "read" ? "tasks.read" : "tasks.write";
    case "activities": return action === "read" ? "activities.read" : "activities.write";
    case "campaigns": return action === "read" ? "campaigns.read" : null;
    case "pipelines": return action === "read" ? "deals.read" : null;
    case "fields": return action === "read" ? "settings.read" : null;
    case "webhooks": return "webhooks.manage";
  }
}

/** Does the key's scope list allow this route? Only a `:write` scope allows mutations; `:write` implies `:read`. */
export function scopeAllows(scopes: readonly string[], resource: ScopeResource, action: ApiAction): boolean {
  if (scopes.includes(`${resource}:write`) && !READ_ONLY.includes(resource)) return true;
  return action === "read" && scopes.includes(`${resource}:read`);
}

/** Permissions a key with these scopes could ever use (static ones only). Used for the creation-time escalation check. */
export function permissionsForScopes(scopes: readonly string[]): string[] {
  const out = new Set<string>();
  for (const s of scopes) {
    const [res, act] = s.split(":") as [ScopeResource, ScopeAction];
    if (!SCOPE_RESOURCES.includes(res) || res === "records") continue;
    const actions: ApiAction[] = act === "write" ? ["create", "update", "delete", "move"] : ["read"];
    for (const a of actions) {
      const p = permissionFor(res, a);
      if (p) out.add(p);
    }
  }
  return [...out].sort();
}
