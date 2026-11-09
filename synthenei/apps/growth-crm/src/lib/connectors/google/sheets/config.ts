// Picks the Sheets gateway for a connection: the mock for Showcase, otherwise the real API with the connection's access token.
import type { ConnectionSecrets } from "../../core/types";
import { GOOGLE_ENV } from "../shared/constants";
import { baseOf, shouldMock } from "../shared/mode";
import { bearerOf } from "../shared/token";
import { makeSheetsApi } from "./api";
import { DEFAULT_SHEETS_API_BASE } from "./constants";
import type { SheetsGateway } from "./gateway";
import { makeMockSheets } from "./mock";

type Env = Record<string, string | undefined>;
export interface SheetsGatewayInput { secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }

export function sheetsGatewayFor(i: SheetsGatewayInput): SheetsGateway {
  if (shouldMock(i.secrets, i.env)) return makeMockSheets();
  return makeSheetsApi({ token: bearerOf(i.secrets), base: baseOf(i.env, GOOGLE_ENV.sheetsApiBase, DEFAULT_SHEETS_API_BASE), fetch: i.fetchImpl, sleep: i.sleep });
}
