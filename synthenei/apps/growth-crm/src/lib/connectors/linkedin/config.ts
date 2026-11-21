// Picks the gateway for a connection. Real calls happen only with real credentials; the mock gateway serves demo/staging showcases
// and is refused in production (a tenant presenting the mock token there gets a credential error, never a fake "connected").
import { CredentialError, type ConnectionSecrets } from "../core/types";
import { CRED, DEFAULT_API_BASE, DEFAULT_API_VERSION, LINKEDIN_ENV } from "./constants";
import type { LinkedInGateway } from "./gateway";
import { LINKEDIN_MOCK_TOKEN, makeMockGateway, type MockGateway } from "./mock";
import { makeRestGateway } from "./rest";

type Env = Record<string, string | undefined>;

export const mockAllowed = (env: Env): boolean => env.APP_ENV !== "production";
export const isMockCredentials = (s: ConnectionSecrets): boolean => s[CRED.accessToken] === LINKEDIN_MOCK_TOKEN;
export const apiBaseOf = (env: Env): string => (env[LINKEDIN_ENV.apiBase] ?? "").trim() || DEFAULT_API_BASE;
export const apiVersionOf = (env: Env): string => (env[LINKEDIN_ENV.apiVersion] ?? "").trim() || DEFAULT_API_VERSION;

const mocks = new Map<string, MockGateway>();
/** Test helper. */
export const resetMockGateways = (): void => mocks.clear();
export const mockFor = (key: string): MockGateway => { let m = mocks.get(key); if (!m) { m = makeMockGateway(); mocks.set(key, m); } return m; };

export interface GatewayInput { connectionId: string; secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch }

export function gatewayFor(i: GatewayInput): LinkedInGateway {
  const token = i.secrets[CRED.accessToken];
  if (isMockCredentials(i.secrets) || (i.env.APP_ENV === "demo" && !token)) {
    if (!mockAllowed(i.env)) throw new CredentialError("The sandbox token is not accepted in production");
    return mockFor(i.connectionId);
  }
  if (!token) throw new CredentialError("LinkedIn credentials are incomplete");
  return makeRestGateway({
    apiBase: apiBaseOf(i.env), version: apiVersionOf(i.env), token, clientId: (i.env[LINKEDIN_ENV.clientId] ?? "").trim() || undefined,
    clientSecret: (i.env[LINKEDIN_ENV.clientSecret] ?? "").trim() || undefined, fetch: i.fetchImpl,
  });
}
