// ConnectorDef for LinkedIn (Lead Gen Forms poll + Ads analytics), registered in src/lib/connectors/all.ts.
// Gate: needs_vendor_approval until LinkedIn grants the Advertising API / Lead Sync products to the platform app. One OAuth connection per
// workspace; after it, selectLinkedInAccount (assets.ts) picks the ad account. Streams: lead form poll (15 min), daily analytics, daily
// token health. No webhook yet: Lead Sync push needs a separate approval and a signature scheme in the T023 receiver (see docs/tasks/T044.md).
import type { ConnectorDef, ConnectionRow, ConnectionSecrets, StreamDef, SyncContext } from "../core/types";
import { CredentialError } from "../core/types";
import { analyticsStep, healthStep } from "./analytics";
import { gatewayFor, isMockCredentials } from "./config";
import { CRED, DEFAULT_API_BASE, LINKEDIN_CONNECTOR_ID, LINKEDIN_ENV, OAUTH_AUTHORIZE_URL, OAUTH_TOKEN_URL, SCOPES } from "./constants";
import type { LinkedInGateway } from "./gateway";
import { DEFAULT_LEAD_MAP, leadsStep } from "./leads";
import type { LinkedInDeps } from "./store";

type Env = Record<string, string | undefined>;
export interface LinkedInRuntime { deps: LinkedInDeps; env: Env; fetchImpl?: typeof fetch }

let factory: (() => Promise<LinkedInRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setLinkedInRuntimeFactory(f: (() => Promise<LinkedInRuntime>) | null): void { factory = f; }
async function runtime(): Promise<LinkedInRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).linkedInRuntime();
}
const gw = (rt: LinkedInRuntime, conn: ConnectionRow, secrets: ConnectionSecrets): LinkedInGateway => gatewayFor({ connectionId: conn.id, secrets, env: rt.env, fetchImpl: rt.fetchImpl });

async function streamCtx(ctx: SyncContext) {
  const rt = await runtime(), secrets = await ctx.secrets();
  return { deps: rt.deps, conn: ctx.conn, secrets, gateway: gw(rt, ctx.conn, secrets), reject: (r: string) => ctx.reject?.(r) };
}

// The scan derives "due" from the connection's single last_sync_at, which the 15-minute lead poll moves constantly, so the daily streams
// are scheduled hourly and decide for themselves (cursor) whether there is anything to do: a missed slot is retried within the hour.
const streams: StreamDef[] = [
  { key: "leads", schedule: { cron: "*/15 * * * *", tz: "Asia/Kolkata" }, run: async (ctx, cursor) => leadsStep(await streamCtx(ctx), cursor) },
  { key: "analytics", schedule: { cron: "25 * * * *", tz: "Asia/Kolkata" }, run: async (ctx, cursor) => analyticsStep(await streamCtx(ctx), cursor) },
  { key: "health", schedule: { cron: "35 * * * *", tz: "Asia/Kolkata" }, run: async (ctx, cursor) => healthStep(await streamCtx(ctx), cursor) },
];

export const linkedinConnector: ConnectorDef = {
  id: LINKEDIN_CONNECTOR_ID, name: "LinkedIn (Lead Gen Forms, Ads)", category: "ads", auth: "oauth2",
  oauth: { authorizeUrl: OAUTH_AUTHORIZE_URL, tokenUrl: OAUTH_TOKEN_URL, scopes: [...SCOPES], pkce: false, clientIdEnv: LINKEDIN_ENV.clientId, clientSecretEnv: LINKEDIN_ENV.clientSecret },
  gate: "needs_vendor_approval",
  sandbox: { supported: true, howTo: "linkedin.sandbox" },
  capabilities: { inbound: true, outbound: false, webhooks: false },
  streams, pushes: [],
  defaultFieldMap: DEFAULT_LEAD_MAP,
  rate: { requestsPerMinute: 60, maxRetries: 4, baseDelayMs: 500, maxDelayMs: 20_000 },
  requiredEnv: [LINKEDIN_ENV.clientId, LINKEDIN_ENV.clientSecret],
  apiBaseEnv: LINKEDIN_ENV.apiBase, defaultApiBase: DEFAULT_API_BASE,
  async test({ conn, secrets }) {
    const t = await gatewayFor({ connectionId: conn.id, secrets, env: process.env as Env }).introspect();
    if (!t.active) throw new CredentialError("LinkedIn says this access token is no longer valid");
    return { accountId: secrets[CRED.adAccountId] };
  },
  // refresh: the framework default (grant_type=refresh_token to oauth.tokenUrl) applies. LinkedIn issues refresh tokens only to approved
  // partners; without one the connection simply expires after about 60 days and the health stream moves it to needs_attention.
};

/** Convenience for the UI layer: true when this connection runs on the sandbox gateway (shows the Showcase label). */
export function isShowcaseConnection(secrets: ConnectionSecrets, env: Env): boolean { return isMockCredentials(secrets) || env.APP_ENV === "demo"; }
