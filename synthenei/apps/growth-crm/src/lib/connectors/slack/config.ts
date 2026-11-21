// Picks the gateway for a connection. Real calls happen only with real credentials; the mock gateway serves demo/staging showcases
// and is refused in production (a tenant presenting the mock token there gets a credential error, never a fake "connected").
import { CredentialError, type ConnectionSecrets } from "../core/types";
import { CRED, DEFAULT_API_BASE, SLACK_ENV, SLACK_MOCK_TOKEN } from "./constants";
import { makeMockGateway, makeSlackGateway, type MockGateway, type SlackGateway } from "./gateway";

type Env = Record<string, string | undefined>;

export const mockAllowed = (env: Env): boolean => env.APP_ENV !== "production";
export const isMockCredentials = (s: ConnectionSecrets): boolean => s[CRED.accessToken] === SLACK_MOCK_TOKEN;
export const apiBaseOf = (env: Env): string => (env[SLACK_ENV.apiBase] ?? "").trim() || DEFAULT_API_BASE;

const mocks = new Map<string, MockGateway>();
/** Test helper. */
export const resetMockGateways = (): void => mocks.clear();
export const mockFor = (key: string): MockGateway => { let m = mocks.get(key); if (!m) { m = makeMockGateway(); mocks.set(key, m); } return m; };

export interface GatewayInput { connectionId: string; secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch }

export function gatewayFor(i: GatewayInput): SlackGateway {
  const token = i.secrets[CRED.accessToken];
  const demo = i.env.APP_ENV === "demo";
  if (isMockCredentials(i.secrets) || (demo && !token)) {
    if (!mockAllowed(i.env)) throw new CredentialError("The sandbox token is not accepted in production");
    return mockFor(i.connectionId);
  }
  if (!token) throw new CredentialError("Slack credentials are incomplete");
  return makeSlackGateway({ apiBase: apiBaseOf(i.env), token, fetch: i.fetchImpl });
}
