// ConnectorDef for Google Analytics 4, registered in src/lib/connectors/all.ts. OAuth (read-only analytics scope) per workspace; after
// it, selectGa4Property (select.ts) picks the property. One stream: the daily report (sessions, users, key events by channel, source /
// medium, device, city, landing page and campaign) into ga4_daily, 90-day backfill then incremental with a 3-day re-read.
import type { ConnectorDef, ConnectionSecrets, SyncContext } from "../../core/types";
import { CredentialError } from "../../core/types";
import { GOOGLE_AUTH_PARAMS, GOOGLE_AUTH_URL, GOOGLE_ENV, GOOGLE_TOKEN_URL, SCOPE } from "../shared/constants";
import { isMockCredentials } from "../shared/mode";
import { refreshGoogleToken } from "../shared/token";
import { ga4GatewayFor } from "./config";
import { GA4_CONNECTOR_ID, STREAM_DAILY } from "./constants";
import { ga4Step } from "./sync";
import type { Ga4Deps } from "./store";

type Env = Record<string, string | undefined>;
export interface Ga4Runtime { deps: Ga4Deps; env: Env; fetchImpl?: typeof fetch }

let factory: (() => Promise<Ga4Runtime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setGa4RuntimeFactory(f: (() => Promise<Ga4Runtime>) | null): void { factory = f; }
async function runtime(): Promise<Ga4Runtime> {
  if (factory) return factory();
  return (await import("./runtime")).ga4Runtime();
}

async function daily(ctx: SyncContext, cursor: unknown) {
  const rt = await runtime(), secrets = await ctx.secrets();
  return ga4Step({ deps: rt.deps, conn: ctx.conn, secrets, gateway: ga4GatewayFor({ secrets, env: rt.env, fetchImpl: rt.fetchImpl }), reject: (r) => ctx.reject?.(r) }, cursor);
}

export const ga4Connector: ConnectorDef = {
  id: GA4_CONNECTOR_ID, name: "Google Analytics 4", category: "analytics", auth: "oauth2",
  oauth: { authorizeUrl: GOOGLE_AUTH_URL, tokenUrl: GOOGLE_TOKEN_URL, scopes: [SCOPE.analytics], pkce: true, extraAuthParams: GOOGLE_AUTH_PARAMS, clientIdEnv: GOOGLE_ENV.clientId, clientSecretEnv: GOOGLE_ENV.clientSecret },
  gate: "none",
  sandbox: { supported: true, howTo: "ga4.sandbox" },
  capabilities: { inbound: true, outbound: false, webhooks: false },
  // The scan derives "due" from the connection's single last_sync_at, so the daily stream is scheduled hourly and the step decides
  // (cursor + IST clock, from 05:30) whether there is anything to load: a missed slot is retried within the hour.
  streams: [{ key: STREAM_DAILY, schedule: { cron: "40 * * * *", tz: "Asia/Kolkata" }, run: daily }],
  pushes: [],
  defaultFieldMap: [],
  rate: { requestsPerMinute: 60, maxRetries: 4, baseDelayMs: 800, maxDelayMs: 30_000 },
  async test({ secrets }) {
    const g = ga4GatewayFor({ secrets, env: process.env as Env });
    const props = await g.listProperties();
    if (!props.length && g.kind === "api") throw new CredentialError("This Google account can read no GA4 property");
    return { accountId: secrets.property_id, accountLabel: props.find((p) => p.id === secrets.property_id)?.name };
  },
  async refresh({ secrets }) { return refreshGoogleToken({ secrets, env: process.env as Env }); },
};

/** For the UI layer: true when this connection runs on the Showcase (mock) gateway. */
export function isShowcaseConnection(secrets: ConnectionSecrets, env: Env): boolean { return isMockCredentials(secrets) || env.APP_ENV === "demo"; }
