// Microsoft identity platform token refresh. Microsoft ROTATES refresh tokens: the new one is stored. A dead grant (revoked, password
// reset, consent removed, refresh token expired after 90 days idle, conditional access) is HTTP 400 `invalid_grant` or
// `interaction_required` / `consent_required`: a CredentialError, so the framework flips the connection to needs_attention. 5xx/429/network
// are TransientError. Tokens are never logged or put in an error message.
import { CredentialError, TransientError, type ConnectionSecrets } from "../core/types";
import { GRAPH_DEFAULT_SCOPE, MOCK_TOKEN, MS_ENV, MS_TOKEN_URL } from "./constants";

type Env = Record<string, string | undefined>;
export interface RefreshInput { secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch; tokenUrl?: string }
export interface RefreshOutput { secrets: ConnectionSecrets; expiresInSec?: number }

export const DEAD_GRANT_ERRORS = new Set(["invalid_grant", "interaction_required", "consent_required", "invalid_client", "unauthorized_client", "access_denied"]);
export const isDeadGrant = (code: unknown): boolean => typeof code === "string" && DEAD_GRANT_ERRORS.has(code);

export async function refreshMicrosoftToken(i: RefreshInput): Promise<RefreshOutput> {
  if (i.secrets.access_token === MOCK_TOKEN) return { secrets: { ...i.secrets }, expiresInSec: 3600 };
  const refresh = i.secrets.refresh_token;
  if (!refresh) throw new CredentialError("This Microsoft connection has no refresh token. Reconnect to continue.");
  const clientId = (i.env[MS_ENV.clientId] ?? "").trim(), clientSecret = (i.env[MS_ENV.clientSecret] ?? "").trim();
  if (!clientId || !clientSecret) throw new CredentialError("The Microsoft app is not configured on this deployment.");
  const f = i.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(i.tokenUrl ?? MS_TOKEN_URL, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId, client_secret: clientSecret, scope: `${GRAPH_DEFAULT_SCOPE} offline_access` }).toString(),
    });
  } catch { throw new TransientError("Microsoft token endpoint unreachable"); }
  if (res.status >= 500 || res.status === 429) throw new TransientError(`Microsoft token endpoint failed (HTTP ${res.status})`);
  let j: Record<string, unknown> = {};
  try { j = (await res.json()) as Record<string, unknown>; } catch { /* handled below */ }
  if (!res.ok || typeof j.access_token !== "string") {
    if (isDeadGrant(j.error) || res.status === 400 || res.status === 401) throw new CredentialError("Microsoft no longer honours this connection (access was revoked or expired). Reconnect to continue.");
    throw new CredentialError(`Microsoft token refresh failed (HTTP ${res.status})`);
  }
  return { secrets: { access_token: j.access_token, refresh_token: typeof j.refresh_token === "string" ? j.refresh_token : refresh }, expiresInSec: typeof j.expires_in === "number" ? j.expires_in : undefined };
}

export function bearerOf(secrets: ConnectionSecrets): string {
  const t = secrets.access_token;
  if (!t) throw new CredentialError("Microsoft credentials are incomplete. Reconnect to continue.");
  return t;
}
