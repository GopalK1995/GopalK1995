// ConnectorDef for Google Ads, registered in src/lib/connectors/all.ts. OAuth (adwords scope) per workspace plus the platform's
// developer token (env GOOGLE_ADS_DEVELOPER_TOKEN; test accounts only until Google grants basic access, which is the gate shown to
// owners). After connecting, selectAdsCustomer (select.ts) picks the client account. One stream: daily cost, clicks, impressions and
// conversions per campaign into campaign_daily_metrics, 30-day backfill then incremental with a 7-day re-read.
import type { ConnectorDef, ConnectionSecrets, SyncContext } from "../../core/types";
import { CredentialError } from "../../core/types";
import { GOOGLE_AUTH_PARAMS, GOOGLE_AUTH_URL, GOOGLE_ENV, GOOGLE_TOKEN_URL, SCOPE } from "../shared/constants";
import { isMockCredentials } from "../shared/mode";
import { refreshGoogleToken } from "../shared/token";
import { adsGatewayFor } from "./config";
import { ADS_CONNECTOR_ID, STREAM_DAILY } from "./constants";
import { adsStep } from "./sync";
import type { AdsDeps } from "./store";

type Env = Record<string, string | undefined>;
export interface AdsRuntime { deps: AdsDeps; env: Env; fetchImpl?: typeof fetch }

let factory: (() => Promise<AdsRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setAdsRuntimeFactory(f: (() => Promise<AdsRuntime>) | null): void { factory = f; }
async function runtime(): Promise<AdsRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).adsRuntime();
}

async function daily(ctx: SyncContext, cursor: unknown) {
  const rt = await runtime(), secrets = await ctx.secrets();
  return adsStep({ deps: rt.deps, conn: ctx.conn, secrets, gateway: adsGatewayFor({ connectionId: ctx.conn.id, secrets, env: rt.env, fetchImpl: rt.fetchImpl }), reject: (r) => ctx.reject?.(r) }, cursor);
}

export const googleAdsConnector: ConnectorDef = {
  id: ADS_CONNECTOR_ID, name: "Google Ads", category: "ads", auth: "oauth2",
  oauth: { authorizeUrl: GOOGLE_AUTH_URL, tokenUrl: GOOGLE_TOKEN_URL, scopes: [SCOPE.adwords], pkce: true, extraAuthParams: GOOGLE_AUTH_PARAMS, clientIdEnv: GOOGLE_ENV.clientId, clientSecretEnv: GOOGLE_ENV.clientSecret },
  gate: "needs_vendor_approval",
  sandbox: { supported: true, howTo: "google-ads.sandbox" },
  capabilities: { inbound: true, outbound: false, webhooks: false },
  // Hourly slot, the step decides from the cursor and the IST clock (from 06:00); see ga4/connector.ts for the reasoning.
  streams: [{ key: STREAM_DAILY, schedule: { cron: "50 * * * *", tz: "Asia/Kolkata" }, run: daily }],
  pushes: [],
  defaultFieldMap: [],
  rate: { requestsPerMinute: 60, maxRetries: 4, baseDelayMs: 800, maxDelayMs: 30_000 },
  requiredEnv: [GOOGLE_ENV.adsDeveloperToken],
  async test({ conn, secrets }) {
    const g = adsGatewayFor({ connectionId: conn.id, secrets, env: process.env as Env });
    const customers = await g.listCustomers();
    if (!customers.length && g.kind === "api") throw new CredentialError("This Google account can read no Google Ads client account");
    return { accountId: secrets.customer_id, accountLabel: customers.find((c) => c.id === secrets.customer_id)?.name };
  },
  async refresh({ secrets }) { return refreshGoogleToken({ secrets, env: process.env as Env }); },
};

/** For the UI layer: true when this connection runs on the Showcase (mock) gateway. */
export function isShowcaseConnection(secrets: ConnectionSecrets, env: Env): boolean { return isMockCredentials(secrets) || env.APP_ENV === "demo"; }
