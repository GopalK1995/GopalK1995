// Token refresh. Meta has no refresh_token: a long-lived (about 60 day) user token is renewed by exchanging it (fb_exchange_token)
// while it is still valid. The framework refresh path (core/lifecycle refreshIfNeeded) calls this through ConnectorDef.refresh when the
// bundle holds a refresh_token; selectMetaAssets stores the long-lived token under that key. Page tokens derived from a long-lived user
// token do not expire, so only the user token (Ads Insights) needs this. A dead token is a CredentialError: needs_attention, never silent.
import { CredentialError, type ConnectionSecrets } from "../core/types";
import { gatewayFor } from "./config";
import { CRED } from "./constants";

type Env = Record<string, string | undefined>;

export async function refreshUserToken(i: { connectionId: string; secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch }): Promise<{ secrets: ConnectionSecrets; expiresInSec?: number }> {
  const current = i.secrets[CRED.refreshToken] ?? i.secrets[CRED.accessToken];
  if (!current) throw new CredentialError("Meta connection has no token to renew");
  const gw = gatewayFor({ ...i, secrets: { ...i.secrets, [CRED.accessToken]: current } });
  const r = await gw.exchangeLongLived();
  return { secrets: { [CRED.accessToken]: r.accessToken, [CRED.refreshToken]: r.accessToken }, expiresInSec: r.expiresInSec };
}
