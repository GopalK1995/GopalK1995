// Meta connection health (AUD-036). Pure helpers over what debug_token and subscribed_apps tell us, stored in integrations.health (jsonb)
// under the key `meta`, plus integrations.token_expires_at for the user token. Nothing here holds a token: only dates, scope names and flags.
import { TOKEN_WARN_DAYS, effectiveScopes } from "./constants";
import type { TokenDebug } from "./gateway";

const DAY_MS = 86400e3;
const secIso = (s: number | null | undefined): string | null => (typeof s === "number" && s > 0 ? new Date(s * 1000).toISOString() : null);

export interface WebhookHealth { subscribed: boolean; /** short PII-free reason when not subscribed */ error: string | null; at: string }
export interface MetaHealth {
  /** user token expiry (debug_token.expires_at); null = Meta says it does not expire, or unknown */
  tokenExpiresAt: string | null;
  tokenNeverExpires: boolean;
  /** when Meta stops allowing data access for this login unless the owner reconnects (debug_token.data_access_expires_at) */
  dataAccessExpiresAt: string | null;
  scopesGranted: string[]; scopesRequested: string[]; scopesMissing: string[];
  webhook: WebhookHealth | null;
  checkedAt: string;
}

/** debug_token -> the facts we store. `webhook` is carried over by the caller (it is written by the asset selection, not by debug_token). */
export function healthFromDebug(d: TokenDebug, now: Date, webhook: WebhookHealth | null = null): MetaHealth {
  const requested = effectiveScopes();
  return {
    tokenExpiresAt: secIso(d.expiresAt), tokenNeverExpires: d.expiresAt === 0, dataAccessExpiresAt: secIso(d.dataAccessExpiresAt),
    scopesGranted: d.scopes, scopesRequested: requested, scopesMissing: d.scopes.length ? requested.filter((s) => !d.scopes.includes(s)) : [],
    webhook, checkedAt: now.toISOString(),
  };
}

/** The earliest date after which Meta calls start failing for this connection, or null when nothing expires / unknown. */
export function effectiveExpiry(h: Pick<MetaHealth, "tokenExpiresAt" | "dataAccessExpiresAt">): string | null {
  const dates = [h.tokenExpiresAt, h.dataAccessExpiresAt].filter((x): x is string => !!x).sort();
  return dates[0] ?? null;
}
export function daysLeft(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((t - now.getTime()) / DAY_MS);
}
/** True when the connection must be renewed soon (inside the warning window) or already is overdue. */
export function expiringSoon(h: Pick<MetaHealth, "tokenExpiresAt" | "dataAccessExpiresAt">, now: Date, warnDays = TOKEN_WARN_DAYS): boolean {
  const left = daysLeft(effectiveExpiry(h), now);
  return left !== null && left < warnDays;
}

/** Reads integrations.health.meta back into a typed shape (defensive: the column is free-form jsonb). */
export function readMetaHealth(health: unknown): MetaHealth | null {
  const m = health && typeof health === "object" ? (health as Record<string, unknown>).meta : null;
  if (!m || typeof m !== "object") return null;
  const o = m as Record<string, unknown>;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const w = o.webhook && typeof o.webhook === "object" ? (o.webhook as Record<string, unknown>) : null;
  return {
    tokenExpiresAt: s(o.tokenExpiresAt), tokenNeverExpires: o.tokenNeverExpires === true, dataAccessExpiresAt: s(o.dataAccessExpiresAt),
    scopesGranted: strs(o.scopesGranted), scopesRequested: strs(o.scopesRequested), scopesMissing: strs(o.scopesMissing),
    webhook: w ? { subscribed: w.subscribed === true, error: s(w.error), at: s(w.at) ?? "" } : null, checkedAt: s(o.checkedAt) ?? "",
  };
}
