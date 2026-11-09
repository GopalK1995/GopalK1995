// Picks the Google Ads gateway for a connection: the mock for Showcase, otherwise the real API with the connection's access token
// and the platform's developer token (env name, value in the deployment).
import type { ConnectionSecrets } from "../../core/types";
import { GOOGLE_ENV } from "../shared/constants";
import { baseOf, shouldMock } from "../shared/mode";
import { bearerOf } from "../shared/token";
import { makeAdsApi } from "./api";
import { DEFAULT_ADS_API_BASE, DEFAULT_ADS_API_VERSION } from "./constants";
import type { AdsGateway } from "./gateway";
import { makeMockAds, type MockAds } from "./mock";

type Env = Record<string, string | undefined>;
export interface AdsGatewayInput { connectionId: string; secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }

const mocks = new Map<string, MockAds>();
/** Test helper. */
export const resetMockAds = (): void => mocks.clear();
export const mockAdsFor = (key: string): MockAds => { let m = mocks.get(key); if (!m) { m = makeMockAds(); mocks.set(key, m); } return m; };

export function adsGatewayFor(i: AdsGatewayInput): AdsGateway {
  if (shouldMock(i.secrets, i.env)) return mockAdsFor(i.connectionId);
  return makeAdsApi({
    token: bearerOf(i.secrets), base: baseOf(i.env, GOOGLE_ENV.adsApiBase, DEFAULT_ADS_API_BASE), version: baseOf(i.env, GOOGLE_ENV.adsApiVersion, DEFAULT_ADS_API_VERSION),
    developerToken: (i.env[GOOGLE_ENV.adsDeveloperToken] ?? "").trim(), loginCustomerId: (i.env[GOOGLE_ENV.adsLoginCustomerId] ?? "").trim() || undefined, fetch: i.fetchImpl, sleep: i.sleep,
  });
}
