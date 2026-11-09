// Google OAuth token refresh with revoked-grant detection. Google answers a dead refresh token (revoked in the Google account, password
// change on some scopes, 6-month inactivity, testing-mode 7-day expiry) with HTTP 400 `invalid_grant`: that is a CredentialError, so the
// framework flips the connection to needs_attention and the owner sees "Reconnect". 5xx/429/network are TransientError (retry). The access
// token and refresh token are never logged or put in an error message.
import { CredentialError, TransientError, type ConnectionSecrets } from "../../core/types";
import { CRED, GOOGLE_ENV, GOOGLE_TOKEN_URL } from "./constants";

type Env = Record<string, string | undefined>;
export interface RefreshInput { secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch; tokenUrl?: string }
export interface RefreshOutput { secrets: ConnectionSecrets; expiresInSec?: number }

/** OAuth error codes meaning "this grant is dead, the user must authorise again". */
export const DEAD_GRANT_ERRORS = new Set(["invalid_grant", "unauthorized_client", "invalid_client", "access_denied"]);
export const isDeadGrant = (code: unknown): boolean => typeof code === "string" && DEAD_GRANT_ERRORS.has(code);

export async function refreshGoogleToken(i: RefreshInput): Promise<RefreshOutput> {
  const refresh = i.secrets[CRED.refreshToken];
  if (!refresh) throw new CredentialError("This Google connection has no refresh token. Reconnect to continue.");
  const clientId = (i.env[GOOGLE_ENV.clientId] ?? "").trim(), clientSecret = (i.env[GOOGLE_ENV.clientSecret] ?? "").trim();
  if (!clientId || !clientSecret) throw new CredentialError("The Google app is not configured on this deployment.");
  const f = i.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(i.tokenUrl ?? GOOGLE_TOKEN_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId, client_secret: clientSecret }).toString(),
    });
  } catch { throw new TransientError("Google token endpoint unreachable"); }
  if (res.status >= 500 || res.status === 429) throw new TransientError(`Google token endpoint failed (HTTP ${res.status})`);
  let j: Record<string, unknown> = {};
  try { j = (await res.json()) as Record<string, unknown>; } catch { /* handled below */ }
  if (!res.ok || typeof j.access_token !== "string") {
    if (isDeadGrant(j.error) || res.status === 400 || res.status === 401) throw new CredentialError("Google no longer honours this connection (access was revoked or expired). Reconnect to continue.");
    throw new CredentialError(`Google token refresh failed (HTTP ${res.status})`);
  }
  // Google does not rotate refresh tokens on refresh; keep the stored one unless a new one is sent.
  const secrets: ConnectionSecrets = { [CRED.accessToken]: j.access_token, [CRED.refreshToken]: typeof j.refresh_token === "string" ? j.refresh_token : refresh };
  return { secrets, expiresInSec: typeof j.expires_in === "number" ? j.expires_in : undefined };
}

/** The bearer token for a call, or a CredentialError when the bundle is empty. */
export function bearerOf(secrets: ConnectionSecrets): string {
  const t = secrets[CRED.accessToken];
  if (!t) throw new CredentialError("Google credentials are incomplete. Reconnect to continue.");
  return t;
}
