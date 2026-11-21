// ConnectorDef for Google Business Profile, registered in src/lib/connectors/all.ts. OAuth (business.manage) per workspace through the
// shared Google client. Gated `needs_vendor_approval`: Google grants the Business Profile APIs to an approved application only, so
// until then the connector runs on fixtures / Showcase and a live connection reports the gate. After connecting, selectGbpLocation
// (select.ts) picks the listing. Streams: `reviews` (every 2 h) and `performance` (daily metrics, trailing week re-read).
import type { ConnectorDef, ConnectionSecrets, SyncContext } from "../../core/types";
import { CredentialError } from "../../core/types";
import { GOOGLE_AUTH_PARAMS, GOOGLE_AUTH_URL, GOOGLE_ENV, GOOGLE_TOKEN_URL } from "../shared/constants";
import { isMockCredentials } from "../shared/mode";
import { refreshGoogleToken } from "../shared/token";
import { gbpGatewayFor } from "./config";
import { GBP_CONNECTOR_ID, GBP_CRED, GBP_SCOPE, STREAM_PERFORMANCE, STREAM_REVIEWS } from "./constants";
import { performanceStep, reviewsStep } from "./sync";
import type { GbpDeps } from "./store";

type Env = Record<string, string | undefined>;
export interface GbpRuntime { deps: GbpDeps; env: Env; fetchImpl?: typeof fetch }

let factory: (() => Promise<GbpRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setGbpRuntimeFactory(f: (() => Promise<GbpRuntime>) | null): void { factory = f; }
async function runtime(): Promise<GbpRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).gbpRuntime();
}

const stream = (step: typeof reviewsStep) => async (ctx: SyncContext, cursor: unknown) => {
  const rt = await runtime(), secrets = await ctx.secrets();
  return step({ deps: rt.deps, conn: ctx.conn, secrets, gateway: gbpGatewayFor({ connectionId: ctx.conn.id, secrets, env: rt.env, fetchImpl: rt.fetchImpl }), reject: (r) => ctx.reject?.(r) }, cursor);
};

export const googleBusinessConnector: ConnectorDef = {
  id: GBP_CONNECTOR_ID, name: "Google Business Profile", category: "data", auth: "oauth2",
  oauth: { authorizeUrl: GOOGLE_AUTH_URL, tokenUrl: GOOGLE_TOKEN_URL, scopes: [GBP_SCOPE], pkce: true, extraAuthParams: GOOGLE_AUTH_PARAMS, clientIdEnv: GOOGLE_ENV.clientId, clientSecretEnv: GOOGLE_ENV.clientSecret },
  gate: "needs_vendor_approval",
  sandbox: { supported: true, howTo: "google-business.sandbox" },
  // Replies are written back to Google, but only by the approval workflow (reply.ts), never by an automated push.
  capabilities: { inbound: true, outbound: true, webhooks: false },
  streams: [
    { key: STREAM_REVIEWS, schedule: { cron: "20 */2 * * *", tz: "Asia/Kolkata" }, run: stream(reviewsStep) },
    { key: STREAM_PERFORMANCE, schedule: { cron: "40 * * * *", tz: "Asia/Kolkata" }, run: stream(performanceStep) },
  ],
  pushes: [],
  defaultFieldMap: [],
  rate: { requestsPerMinute: 60, maxRetries: 4, baseDelayMs: 800, maxDelayMs: 30_000 },
  async test({ conn, secrets }) {
    const g = gbpGatewayFor({ connectionId: conn.id, secrets, env: process.env as Env });
    const locations = await g.listLocations();
    if (!locations.length && g.kind === "api") throw new CredentialError("This Google account manages no Business Profile listing");
    return { accountId: secrets[GBP_CRED.location], accountLabel: locations.find((l) => l.location === secrets[GBP_CRED.location])?.title };
  },
  async refresh({ secrets }) { return refreshGoogleToken({ secrets, env: process.env as Env }); },
};

/** For the UI layer: true when this connection runs on the Showcase (mock) gateway. */
export function isGbpShowcase(secrets: ConnectionSecrets, env: Env): boolean { return isMockCredentials(secrets) || env.APP_ENV === "demo"; }
