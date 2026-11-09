// Picks the GA4 gateway for a connection: the mock for Showcase, otherwise the real APIs with the connection's access token.
import type { ConnectionSecrets } from "../../core/types";
import { GOOGLE_ENV } from "../shared/constants";
import { baseOf, shouldMock } from "../shared/mode";
import { bearerOf } from "../shared/token";
import { DEFAULT_ADMIN_API_BASE, DEFAULT_DATA_API_BASE } from "./constants";
import { makeGa4Api } from "./api";
import type { Ga4Gateway } from "./gateway";
import { makeMockGa4 } from "./mock";

type Env = Record<string, string | undefined>;
export interface Ga4GatewayInput { secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }

export function ga4GatewayFor(i: Ga4GatewayInput): Ga4Gateway {
  if (shouldMock(i.secrets, i.env)) return makeMockGa4();
  return makeGa4Api({ token: bearerOf(i.secrets), dataBase: baseOf(i.env, GOOGLE_ENV.ga4DataApiBase, DEFAULT_DATA_API_BASE), adminBase: baseOf(i.env, GOOGLE_ENV.ga4AdminApiBase, DEFAULT_ADMIN_API_BASE), fetch: i.fetchImpl, sleep: i.sleep });
}
