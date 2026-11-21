// Picks the Graph gateway for a connection: the mock for Showcase, otherwise Microsoft Graph with the connection's token.
import { CredentialError, type ConnectionRow, type ConnectionSecrets } from "../core/types";
import { makeGraphApi } from "./api";
import { DEFAULT_GRAPH_BASE, MOCK_TOKEN, MS_ENV } from "./constants";
import type { GraphGateway } from "./gateway";
import { makeMockGraph, type MockGraph } from "./mock";
import { bearerOf } from "./token";

type Env = Record<string, string | undefined>;
export interface GraphGatewayInput { connectionId: string; secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }

const mocks = new Map<string, MockGraph>();
export const resetMockGraph = (): void => mocks.clear();
export const mockGraphFor = (key: string): MockGraph => { let m = mocks.get(key); if (!m) { m = makeMockGraph(); mocks.set(key, m); } return m; };

export const isMockCredentials = (s: ConnectionSecrets): boolean => s.access_token === MOCK_TOKEN;
/** True when the Showcase gateway should serve this connection. Throws in production for the sandbox token. */
export function shouldMock(secrets: ConnectionSecrets, env: Env): boolean {
  if (isMockCredentials(secrets) || (env.APP_ENV === "demo" && !secrets.access_token)) {
    if (env.APP_ENV === "production") throw new CredentialError("The sandbox token is not accepted in production");
    return true;
  }
  return false;
}
export const graphBase = (env: Env): string => ((env[MS_ENV.graphApiBase] ?? "").trim() || DEFAULT_GRAPH_BASE).replace(/\/+$/, "");

export function graphGatewayFor(i: GraphGatewayInput): GraphGateway {
  if (shouldMock(i.secrets, i.env)) return mockGraphFor(i.connectionId);
  return makeGraphApi({ token: bearerOf(i.secrets), base: graphBase(i.env), fetch: i.fetchImpl, sleep: i.sleep });
}

/** A connection of another workspace or tenant looks exactly like a missing one. */
export const sameScope = (conn: ConnectionRow | null, a: { tenantId: string; workspaceId: string }, connectorId: string): conn is ConnectionRow =>
  !!conn && conn.connectorId === connectorId && conn.tenantId === a.tenantId && conn.workspaceId === a.workspaceId;
