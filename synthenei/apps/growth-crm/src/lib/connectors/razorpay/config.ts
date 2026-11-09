// Picks the gateway for a connection. Real calls happen only with real credentials; the mock gateway serves demo/staging showcases
// and is refused in production (a tenant pasting the mock secret there gets a credential error, never a fake "connected").
import { CredentialError, type ConnectionSecrets } from "../core/types";
import { CRED, DEFAULT_API_BASE, RZP_ENV } from "./constants";
import type { RazorpayGateway } from "./gateway";
import { makeApiGateway } from "./api";
import { RZP_MOCK_KEY_SECRET, makeMockGateway, type MockRazorpay } from "./mock";

type Env = Record<string, string | undefined>;

export const mockAllowed = (env: Env): boolean => env.APP_ENV !== "production";
export const isMockCredentials = (s: ConnectionSecrets): boolean => s[CRED.keySecret] === RZP_MOCK_KEY_SECRET;
export const apiBaseOf = (env: Env): string => (env[RZP_ENV.apiBase] ?? "").trim() || DEFAULT_API_BASE;
/** Razorpay keys carry their mode in the id: rzp_test_ = test mode (real vendor, fake money), rzp_live_ = live. */
export const keyMode = (s: ConnectionSecrets): "test" | "live" | "unknown" => (s[CRED.keyId]?.startsWith("rzp_test_") ? "test" : s[CRED.keyId]?.startsWith("rzp_live_") ? "live" : "unknown");

const mocks = new Map<string, MockRazorpay>();
export const resetMockGateways = (): void => mocks.clear();
export const mockFor = (key: string): MockRazorpay => { let m = mocks.get(key); if (!m) { m = makeMockGateway(); mocks.set(key, m); } return m; };

export interface GatewayInput { connectionId: string; secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch }

export function gatewayFor(i: GatewayInput): RazorpayGateway {
  const id = i.secrets[CRED.keyId], secret = i.secrets[CRED.keySecret];
  const demo = i.env.APP_ENV === "demo";
  if (isMockCredentials(i.secrets) || (demo && !secret)) {
    if (!mockAllowed(i.env)) throw new CredentialError("The showcase key is not accepted in production");
    return mockFor(i.connectionId);
  }
  if (!id || !secret) throw new CredentialError("Razorpay credentials are incomplete");
  return makeApiGateway({ apiBase: apiBaseOf(i.env), keyId: id, keySecret: secret, fetch: i.fetchImpl });
}

/** True when this connection runs on the showcase gateway (the UI shows the Showcase label). */
export const isShowcaseConnection = (secrets: ConnectionSecrets, env: Env): boolean => isMockCredentials(secrets) || env.APP_ENV === "demo";
