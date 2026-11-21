// Zoho token refresh. The accounts server depends on the connection's data centre. Zoho answers many failures with HTTP 200 and an
// `error` body, so the body is inspected: a dead refresh token is a CredentialError (needs_attention), a throttled refresh is transient.
import { CredentialError, TransientError, type ConnectionSecrets } from "../core/types";
import { accountsUrlOf } from "./config";
import { CRED, ZOHO_ENV } from "./constants";

type Env = Record<string, string | undefined>;

export async function refreshZohoToken(i: { secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch }): Promise<{ secrets: ConnectionSecrets; expiresInSec?: number }> {
  const refresh = i.secrets[CRED.refreshToken];
  if (!refresh) throw new CredentialError("Zoho connection has no refresh token");
  const clientId = (i.env[ZOHO_ENV.clientId] ?? "").trim(), clientSecret = (i.env[ZOHO_ENV.clientSecret] ?? "").trim();
  if (!clientId || !clientSecret) throw new CredentialError("Zoho client credentials are not configured");
  const f = i.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f(`${accountsUrlOf(i.secrets, i.env)}/oauth/v2/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh, client_id: clientId, client_secret: clientSecret }).toString(),
    });
  } catch { throw new TransientError("Zoho accounts server unreachable"); }
  if (res.status >= 500 || res.status === 429) throw new TransientError(`Zoho accounts server failed (HTTP ${res.status})`);
  let j: Record<string, unknown> = {};
  try { j = (await res.json()) as Record<string, unknown>; } catch { /* handled below */ }
  if (typeof j.access_token === "string") {
    const secs = typeof j.expires_in_sec === "number" ? j.expires_in_sec : typeof j.expires_in === "number" ? j.expires_in : undefined;
    // Zoho has returned expires_in in milliseconds in some API versions: an hour is 3600 s, anything above a day is not seconds
    return { secrets: { [CRED.accessToken]: j.access_token }, expiresInSec: secs === undefined ? 3600 : secs > 86_400 ? Math.round(secs / 1000) : secs };
  }
  // "Access Denied ... too many requests" is a throttle on refreshes (about 10 per 10 minutes), not a dead token
  if (typeof j.error === "string" && /too many|rate|limit|try again/i.test(`${j.error} ${String(j.error_description ?? "")}`)) throw new TransientError("Zoho is throttling token refreshes", 10 * 60_000);
  throw new CredentialError("Zoho refused the refresh token (reconnect needed)");
}
