// Admin-consent link for firms. A tenant admin of the customer firm opens the link once and approves the app for the whole tenant, so
// staff do not each hit "needs admin approval". Pure: the caller supplies the redirect URI (allowlisted through core/oauth
// resolveRedirectUri) and a one-time state (core/oauth randomToken); the return is checked with parseAdminConsentReturn.
import { stateMatches } from "../core/oauth";
import { GRAPH_DEFAULT_SCOPE, MS_ENV, MS_LOGIN_BASE } from "./constants";

type Env = Record<string, string | undefined>;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** `organizations` (admin picks their own tenant at sign-in) unless the firm's tenant id or a verified domain is known. Null = refused. */
export function tenantSegment(hint?: string | null): string | null {
  const h = (hint ?? "").trim();
  if (!h) return "organizations";
  return GUID.test(h) || DOMAIN.test(h) ? h.toLowerCase() : null;
}

export type ConsentLink = { ok: true; url: string } | { ok: false; reason: "not_configured" | "bad_tenant" | "bad_redirect" | "missing_state" };

export function buildAdminConsentUrl(env: Env, i: { tenantHint?: string | null; redirectUri: string; state: string }): ConsentLink {
  const clientId = (env[MS_ENV.clientId] ?? "").trim();
  if (!clientId) return { ok: false, reason: "not_configured" };
  const tenant = tenantSegment(i.tenantHint);
  if (!tenant) return { ok: false, reason: "bad_tenant" };
  if (!i.state || i.state.length < 16) return { ok: false, reason: "missing_state" };
  try { const u = new URL(i.redirectUri); if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return { ok: false, reason: "bad_redirect" }; } catch { return { ok: false, reason: "bad_redirect" }; }
  const u = new URL(`${MS_LOGIN_BASE}/${tenant}/v2.0/adminconsent`);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("scope", GRAPH_DEFAULT_SCOPE);
  u.searchParams.set("redirect_uri", i.redirectUri);
  u.searchParams.set("state", i.state);
  return { ok: true, url: u.toString() };
}

export type ConsentReturn = { ok: true; tenantId: string } | { ok: false; reason: "denied" | "state_mismatch" | "malformed" };
/** Microsoft redirects back with `admin_consent=True&tenant=<guid>&state=..`, or `error=..`. */
export function parseAdminConsentReturn(q: { admin_consent?: string | null; tenant?: string | null; state?: string | null; error?: string | null }, expectedState: string): ConsentReturn {
  if (q.error) return { ok: false, reason: "denied" };
  if (!stateMatches(q.state, expectedState)) return { ok: false, reason: "state_mismatch" };
  if ((q.admin_consent ?? "").toLowerCase() !== "true" || !q.tenant || !GUID.test(q.tenant)) return { ok: false, reason: "malformed" };
  return { ok: true, tenantId: q.tenant.toLowerCase() };
}
