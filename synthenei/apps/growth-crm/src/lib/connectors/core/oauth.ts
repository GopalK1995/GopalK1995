// OAuth helper: state + PKCE, HMAC-signed httpOnly cookie payload, redirect URI allowlist, code exchange and refresh.
// Pure with injected clock/random/fetch so tampering, expiry and allowlist rules are unit-tested. Tokens are returned to the
// caller (which puts them in the Vault) and are never logged here.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CredentialError, TransientError, type ConnectionSecrets, type OAuthSpec } from "./types";

export const OAUTH_COOKIE_PREFIX = "gcrm_oauth_";
export const OAUTH_COOKIE_TTL_S = 600;
export const cookieName = (connector: string) => `${OAUTH_COOKIE_PREFIX}${connector}`;

const b64u = (b: Buffer) => b.toString("base64url");
export const randomToken = (bytes = 32, rnd: (n: number) => Buffer = randomBytes) => b64u(rnd(bytes));
export const sha256b64u = (s: string) => b64u(createHash("sha256").update(s).digest());

/** RFC 7636 S256 challenge. */
export function pkcePair(rnd: (n: number) => Buffer = randomBytes): { verifier: string; challenge: string } {
  const verifier = randomToken(48, rnd);
  return { verifier, challenge: sha256b64u(verifier) };
}

export interface OAuthCookie { state: string; verifier: string | null; ws: string; uid: string; connector: string; conn: string | null; exp: number; returnTo: string }

const mac = (secret: string, body: string) => createHmac("sha256", `oauth-cookie|${secret}`).update(body).digest();

export function signCookie(payload: OAuthCookie, secret: string): string {
  if (!secret) throw new Error("oauth: signing secret missing");
  const body = b64u(Buffer.from(JSON.stringify(payload)));
  return `${body}.${b64u(mac(secret, body))}`;
}
export type CookieCheck = { ok: true; value: OAuthCookie } | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "expired" };
export function verifyCookie(token: string | undefined | null, secret: string, nowMs = Date.now()): CookieCheck {
  if (!token) return { ok: false, reason: "missing" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [body, sig] = parts;
  const expected = mac(secret, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  try {
    const v = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthCookie;
    if (typeof v.exp !== "number" || v.exp < nowMs) return { ok: false, reason: "expired" };
    return { ok: true, value: v };
  } catch { return { ok: false, reason: "malformed" }; }
}
/** Constant-time compare of the state in the query with the one in the signed cookie. */
export function stateMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export const stateHash = sha256b64u;

type RedirectEnv = { OAUTH_REDIRECT_URIS?: string; APP_BASE_URL?: string };
/** Redirect URIs allowed for this deployment: OAUTH_REDIRECT_URIS (comma list) or the one derived from the app base URL. */
export function redirectAllowlist(env: RedirectEnv, connector: string): string[] {
  const listed = (env.OAUTH_REDIRECT_URIS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (listed.length) return listed;
  const base = (env.APP_BASE_URL ?? "").replace(/\/+$/, "");
  return base ? [`${base}/api/oauth/${connector}/callback`] : [];
}
/** Picks the redirect URI for a connector, or null when it is not allowlisted (https only, http only for localhost). */
export function resolveRedirectUri(env: RedirectEnv, connector: string, requested?: string | null): string | null {
  const allow = redirectAllowlist(env, connector).filter((u) => u.endsWith(`/api/oauth/${connector}/callback`));
  const pick = requested ?? allow[0];
  if (!pick || !allow.includes(pick)) return null;
  try {
    const u = new URL(pick);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
    if (u.hash) return null;
  } catch { return null; }
  return pick;
}
/** Where to send the browser after the callback: only paths inside /integrations (blocks open redirects). */
export function safeReturnPath(p: string | null | undefined, fallback: string): string {
  if (!p || !p.startsWith("/integrations") || p.startsWith("//") || /[\\\r\n]/.test(p) || p.includes("://")) return fallback;
  return p;
}

export function buildAuthorizeUrl(spec: OAuthSpec, a: { clientId: string; redirectUri: string; state: string; challenge?: string | null }): string {
  const u = new URL(spec.authorizeUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", a.clientId);
  u.searchParams.set("redirect_uri", a.redirectUri);
  u.searchParams.set("state", a.state);
  if (spec.scopes.length) u.searchParams.set("scope", spec.scopes.join(" "));
  if (spec.pkce && a.challenge) { u.searchParams.set("code_challenge", a.challenge); u.searchParams.set("code_challenge_method", "S256"); }
  for (const [k, v] of Object.entries(spec.extraAuthParams ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

export interface TokenResult { secrets: ConnectionSecrets; expiresInSec?: number; scopes?: string[] }
type FetchLike = typeof fetch;

async function tokenCall(spec: OAuthSpec, form: Record<string, string>, f: FetchLike): Promise<TokenResult> {
  let res: Response;
  try {
    res = await f(spec.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(form).toString() });
  } catch { throw new TransientError("Token endpoint unreachable"); }
  if (res.status >= 500 || res.status === 429) throw new TransientError(`Token endpoint failed (HTTP ${res.status})`);
  let j: Record<string, unknown> = {};
  try { j = (await res.json()) as Record<string, unknown>; } catch { /* handled below */ }
  if (!res.ok || typeof j.access_token !== "string") {
    // invalid_grant means the refresh token or code is dead: the owner has to reconnect. The vendor text is not echoed.
    throw new CredentialError(res.status === 400 || res.status === 401 ? "The vendor refused the authorisation (reconnect needed)" : `Token exchange failed (HTTP ${res.status})`);
  }
  const secrets: ConnectionSecrets = { access_token: j.access_token };
  if (typeof j.refresh_token === "string") secrets.refresh_token = j.refresh_token;
  return { secrets, expiresInSec: typeof j.expires_in === "number" ? j.expires_in : undefined, scopes: typeof j.scope === "string" ? j.scope.split(/[ ,]+/).filter(Boolean) : undefined };
}

export function exchangeCode(spec: OAuthSpec, a: { code: string; redirectUri: string; clientId: string; clientSecret: string; verifier?: string | null }, f: FetchLike = fetch): Promise<TokenResult> {
  const form: Record<string, string> = { grant_type: "authorization_code", code: a.code, redirect_uri: a.redirectUri, client_id: a.clientId, client_secret: a.clientSecret };
  if (spec.pkce && a.verifier) form.code_verifier = a.verifier;
  return tokenCall(spec, form, f);
}
export async function refreshToken(spec: OAuthSpec, a: { refreshToken: string; clientId: string; clientSecret: string }, f: FetchLike = fetch): Promise<TokenResult> {
  const r = await tokenCall(spec, { grant_type: "refresh_token", refresh_token: a.refreshToken, client_id: a.clientId, client_secret: a.clientSecret }, f);
  // Vendors that do not rotate refresh tokens omit it: keep the old one.
  if (!r.secrets.refresh_token) r.secrets.refresh_token = a.refreshToken;
  return r;
}
