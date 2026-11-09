// ConnectorDef for Meta (Lead Ads + Instagram DMs + Ads Insights), registered in src/lib/connectors/all.ts.
// One OAuth connection (Facebook Login) per workspace; after it, selectMetaAssets (assets.ts) picks the page, the linked Instagram
// account and the ad account. Streams: daily insights, the Instagram dispatcher and a daily token health check. Webhook: the parsed,
// already-signature-verified delivery (X-Hub-Signature-256 with the app secret, T023 receiver) goes through leads.ts / inbound.ts.
import type { ConnectorDef, ConnectionRow, ConnectionSecrets, StreamDef, SyncContext, SyncResult } from "../core/types";
import { CredentialError } from "../core/types";
import { gatewayFor, isMockCredentials } from "./config";
import { CRED, DEFAULT_API_BASE, META_CONNECTOR_ID, META_ENV, OAUTH_DIALOG_URL, OAUTH_TOKEN_URL, SCOPES } from "./constants";
import type { MetaGateway } from "./gateway";
import { healthStep, insightsStep } from "./insights";
import { handleIgMessage } from "./inbound";
import { DEFAULT_LEAD_MAP, handleLeadgen } from "./leads";
import { dispatchQueued } from "./outbound";
import { parseWebhook, type MetaEvent } from "./payload";
import type { MetaDeps } from "./store";
import { refreshUserToken } from "./token";

type Env = Record<string, string | undefined>;
export interface MetaRuntime { deps: MetaDeps; env: Env; fetchImpl?: typeof fetch }

let factory: (() => Promise<MetaRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setMetaRuntimeFactory(f: (() => Promise<MetaRuntime>) | null): void { factory = f; }
async function runtime(): Promise<MetaRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).metaRuntime();
}
const gw = (rt: MetaRuntime, conn: ConnectionRow, secrets: ConnectionSecrets): MetaGateway => gatewayFor({ connectionId: conn.id, secrets, env: rt.env, fetchImpl: rt.fetchImpl });

async function streamCtx(ctx: SyncContext) {
  const rt = await runtime(), secrets = await ctx.secrets();
  return { rt, c: { deps: rt.deps, conn: ctx.conn, secrets, gateway: gw(rt, ctx.conn, secrets), reject: (r: string) => ctx.reject?.(r) } };
}

async function dispatchStream(ctx: SyncContext): Promise<SyncResult> {
  const { rt, c } = await streamCtx(ctx);
  if (!c.secrets[CRED.igUserId]) return { cursor: null, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_instagram_account" } };
  let rejected = 0;
  const s = await dispatchQueued(rt.deps, ctx.conn, c.gateway, (reason) => { rejected++; ctx.reject?.(reason); });
  return { cursor: null, rowsIn: s.sent, rowsRejected: rejected, done: true, sample: { sent: s.sent, blocked: s.blocked, failed: s.failed, retry: s.retry, mode: c.gateway.kind } };
}

// The scan derives "due" from the connection's single last_sync_at, which the 15-minute dispatcher moves constantly, so the daily
// streams are scheduled hourly and decide for themselves (cursor) whether there is anything to do: a missed slot is retried within the hour.
const streams: StreamDef[] = [
  { key: "insights", schedule: { cron: "25 * * * *", tz: "Asia/Kolkata" }, run: async (ctx, cursor) => insightsStep((await streamCtx(ctx)).c, cursor) },
  { key: "health", schedule: { cron: "35 * * * *", tz: "Asia/Kolkata" }, run: async (ctx, cursor) => healthStep((await streamCtx(ctx)).c, cursor) },
  { key: "dispatch", schedule: { cron: "*/15 * * * *", tz: "Asia/Kolkata" }, run: (ctx) => dispatchStream(ctx) },
];

export const metaAdsConnector: ConnectorDef = {
  id: META_CONNECTOR_ID, name: "Meta (Lead Ads, Instagram, Ads)", category: "ads", auth: "oauth2",
  oauth: { authorizeUrl: OAUTH_DIALOG_URL, tokenUrl: OAUTH_TOKEN_URL, scopes: [...SCOPES], pkce: false, clientIdEnv: META_ENV.appId, clientSecretEnv: META_ENV.appSecret },
  gate: "needs_vendor_approval",
  sandbox: { supported: true, howTo: "meta-ads.sandbox" },
  capabilities: { inbound: true, outbound: true, webhooks: true },
  streams, pushes: [],
  webhook: {
    // The edge already verified X-Hub-Signature-256 on the raw body (verify/receive.ts); this only parses it.
    async verify(req) { return parseWebhook(req.rawBody); },
    async handle(ctx, evt) {
      const e = evt as MetaEvent, rt = await runtime(), secrets = await ctx.secrets();
      const c = { deps: rt.deps, conn: ctx.conn, secrets, gateway: gw(rt, ctx.conn, secrets), reject: (r: string) => ctx.reject?.(r) };
      if (e.kind === "leadgen") await handleLeadgen(c, e);
      else await handleIgMessage(c, e);
    },
  },
  defaultFieldMap: DEFAULT_LEAD_MAP,
  rate: { requestsPerMinute: 200, maxRetries: 4, baseDelayMs: 500, maxDelayMs: 20_000 },
  requiredEnv: [META_ENV.appId, META_ENV.appSecret],
  apiBaseEnv: META_ENV.apiBase, defaultApiBase: DEFAULT_API_BASE,
  async test({ conn, secrets }) {
    const g = gatewayFor({ connectionId: conn.id, secrets, env: process.env as Env });
    const d = await g.debugToken();
    if (!d.valid) throw new CredentialError("Meta says this access token is no longer valid");
    return { accountId: secrets[CRED.pageId], accountLabel: undefined };
  },
  /** Meta renews a long-lived user token by exchanging it; there is no refresh_token grant. */
  async refresh({ conn, secrets }) { return refreshUserToken({ connectionId: conn.id, secrets, env: process.env as Env }); },
};

/** Convenience for the UI layer: true when this connection runs on the sandbox gateway (shows the Showcase label). */
export function isShowcaseConnection(secrets: ConnectionSecrets, env: Env): boolean { return isMockCredentials(secrets) || env.APP_ENV === "demo"; }
