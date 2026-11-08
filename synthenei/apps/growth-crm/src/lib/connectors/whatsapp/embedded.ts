// Embedded signup (Meta Tech Provider flow), server half. The browser half (Facebook JS SDK popup, config id from
// WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID) returns a short-lived `code` plus the new waba_id and phone_number_id; this exchanges
// the code for a token with the PLATFORM app (env, never per tenant) and subscribes the app to the account's webhooks.
// The result is the same credential bundle the manual form produces, so connectWithCredentials() stores it in the Vault.
import { CredentialError, TransientError, type ConnectionSecrets } from "../core/types";
import { CRED, WA_ENV } from "./constants";
import { apiBaseOf, apiVersionOf } from "./config";

type Env = Record<string, string | undefined>;
export const embeddedConfigured = (env: Env): boolean => [WA_ENV.appId, WA_ENV.appSecret, WA_ENV.embeddedSignupConfigId].every((k) => (env[k] ?? "").trim() !== "");

export interface EmbeddedInput { code: string; wabaId: string; phoneNumberId: string }

export async function completeEmbeddedSignup(input: EmbeddedInput, env: Env, f: typeof fetch = fetch): Promise<ConnectionSecrets> {
  const appId = env[WA_ENV.appId]?.trim(), appSecret = env[WA_ENV.appSecret]?.trim();
  if (!appId || !appSecret) throw new CredentialError("Embedded signup is not configured on this deployment");
  if (!/^\d{5,32}$/.test(input.wabaId) || !/^\d{5,32}$/.test(input.phoneNumberId) || !input.code) throw new CredentialError("Embedded signup returned incomplete data");
  const base = `${apiBaseOf(env).replace(/\/+$/, "")}/${apiVersionOf(env)}`;
  const tokenUrl = `${base}/oauth/access_token?${new URLSearchParams({ client_id: appId, client_secret: appSecret, code: input.code })}`;
  let res: Response;
  try { res = await f(tokenUrl, { method: "GET", headers: { accept: "application/json" } }); } catch { throw new TransientError("Meta unreachable"); }
  if (!res.ok) { if (res.status >= 500 || res.status === 429) throw new TransientError(`Meta token exchange failed (HTTP ${res.status})`); throw new CredentialError("Meta rejected the signup code"); }
  const token = ((await res.json()) as { access_token?: unknown }).access_token;
  if (typeof token !== "string" || !token) throw new CredentialError("Meta returned no access token");
  // Subscribe our app to the account so message and status webhooks flow. Failure is not silent: the owner sees it and can retry.
  const sub = await f(`${base}/${input.wabaId}/subscribed_apps`, { method: "POST", headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  if (!sub || !sub.ok) throw new TransientError("Could not subscribe the app to the WhatsApp account");
  return { [CRED.wabaId]: input.wabaId, [CRED.phoneNumberId]: input.phoneNumberId, [CRED.accessToken]: token, [CRED.appSecret]: appSecret };
}
