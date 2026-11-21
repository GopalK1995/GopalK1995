// Picks the Business Profile gateway for a connection: the mock for Showcase, otherwise the real APIs with the connection's token.
import type { ConnectionSecrets } from "../../core/types";
import { baseOf, shouldMock } from "../shared/mode";
import { bearerOf } from "../shared/token";
import { makeGbpApi } from "./api";
import { DEFAULT_ACCOUNTS_BASE, DEFAULT_INFO_BASE, DEFAULT_PERFORMANCE_BASE, DEFAULT_REVIEWS_BASE, GBP_ENV } from "./constants";
import type { GbpGateway } from "./gateway";
import { makeMockGbp, type MockGbp } from "./mock";

type Env = Record<string, string | undefined>;
export interface GbpGatewayInput { connectionId: string; secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }

const mocks = new Map<string, MockGbp>();
export const resetMockGbp = (): void => mocks.clear();
export const mockGbpFor = (key: string): MockGbp => { let m = mocks.get(key); if (!m) { m = makeMockGbp(); mocks.set(key, m); } return m; };

export function gbpGatewayFor(i: GbpGatewayInput): GbpGateway {
  if (shouldMock(i.secrets, i.env)) return mockGbpFor(i.connectionId);
  return makeGbpApi({
    token: bearerOf(i.secrets), fetch: i.fetchImpl, sleep: i.sleep,
    accountsBase: baseOf(i.env, GBP_ENV.accountsApiBase, DEFAULT_ACCOUNTS_BASE), infoBase: baseOf(i.env, GBP_ENV.infoApiBase, DEFAULT_INFO_BASE),
    performanceBase: baseOf(i.env, GBP_ENV.performanceApiBase, DEFAULT_PERFORMANCE_BASE), reviewsBase: baseOf(i.env, GBP_ENV.reviewsApiBase, DEFAULT_REVIEWS_BASE),
  });
}
