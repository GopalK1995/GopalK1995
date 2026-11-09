// Picks the gateway for a connection. Real calls happen only with real credentials; the mock gateway serves demo/staging
// showcases and is refused in production (a tenant presenting the mock token there gets a credential error, never a fake "connected").
import { CredentialError, type ConnectionSecrets } from "../core/types";
import { CRED, DEFAULT_API_BASE, DEFAULT_API_VERSION, META_ENV } from "./constants";
import type { MetaGateway } from "./gateway";
import { makeGraphGateway } from "./graph";
import { META_MOCK_TOKEN, makeMockGateway, type MockGateway } from "./mock";

type Env = Record<string, string | undefined>;

export const mockAllowed = (env: Env): boolean => env.APP_ENV !== "production";
export const isMockCredentials = (s: ConnectionSecrets): boolean => s[CRED.accessToken] === META_MOCK_TOKEN;
export const apiBaseOf = (env: Env): string => (env[META_ENV.apiBase] ?? "").trim() || DEFAULT_API_BASE;
export const apiVersionOf = (env: Env): string => (env[META_ENV.apiVersion] ?? "").trim() || DEFAULT_API_VERSION;

const mocks = new Map<string, MockGateway>();
/** Test helper. */
export const resetMockGateways = (): void => mocks.clear();
export const mockFor = (key: string): MockGateway => { let m = mocks.get(key); if (!m) { m = makeMockGateway(); mocks.set(key, m); } return m; };

export interface GatewayInput { connectionId: string; secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch }

export function gatewayFor(i: GatewayInput): MetaGateway {
  const token = i.secrets[CRED.accessToken];
  const demo = i.env.APP_ENV === "demo";
  if (isMockCredentials(i.secrets) || (demo && !token)) {
    if (!mockAllowed(i.env)) throw new CredentialError("The sandbox token is not accepted in production");
    return mockFor(i.connectionId);
  }
  if (!token) throw new CredentialError("Meta credentials are incomplete");
  return makeGraphGateway({
    apiBase: apiBaseOf(i.env), version: apiVersionOf(i.env), userToken: token, pageToken: i.secrets[CRED.pageToken], pageId: i.secrets[CRED.pageId], igUserId: i.secrets[CRED.igUserId],
    appId: (i.env[META_ENV.appId] ?? "").trim() || undefined, appSecret: (i.env[META_ENV.appSecret] ?? "").trim() || undefined, fetch: i.fetchImpl,
  });
}
