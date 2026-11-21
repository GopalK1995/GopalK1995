// ConnectorDef for Google Calendar (id `google-calendar`), registered in src/lib/connectors/all.ts. Per-user OAuth with the sensitive
// calendar.events scope (no restricted scope, no Gmail scope: Gmail is a separate connector and a separate consent). Two streams, pull
// and push, every 15 minutes (the scan slot); both are incremental and idempotent.
import type { ConnectionSecrets, ConnectorDef, SyncContext } from "../../core/types";
import { CredentialError } from "../../core/types";
import { GOOGLE_AUTH_PARAMS, GOOGLE_AUTH_URL, GOOGLE_ENV, GOOGLE_TOKEN_URL } from "../shared/constants";
import { isMockCredentials } from "../shared/mode";
import { calendarGatewayFor } from "./config";
import { CALENDAR_CONNECTOR_ID, CALENDAR_SCOPE, STREAM_PULL, STREAM_PUSH } from "./constants";
import { grantFor, refreshAllGrants } from "./grants";
import { calendarPullStep, calendarPushStep } from "./sync";
import type { CalendarDeps } from "./store";

type Env = Record<string, string | undefined>;
export interface CalendarRuntime { deps: CalendarDeps; env: Env; fetchImpl?: typeof fetch }

let factory: (() => Promise<CalendarRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setCalendarRuntimeFactory(f: (() => Promise<CalendarRuntime>) | null): void { factory = f; }
export async function calendarRuntime(): Promise<CalendarRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).calendarRuntimeFromService();
}

async function run(ctx: SyncContext, cursor: unknown, step: typeof calendarPullStep) {
  const rt = await calendarRuntime(), secrets = await ctx.secrets();
  return step({ deps: rt.deps, conn: ctx.conn, secrets, gateway: calendarGatewayFor({ secrets, env: rt.env, fetchImpl: rt.fetchImpl }), reject: (r) => ctx.reject?.(r) }, cursor);
}

export const googleCalendarConnector: ConnectorDef = {
  id: CALENDAR_CONNECTOR_ID, name: "Google Calendar", category: "scheduling", auth: "oauth2",
  oauth: { authorizeUrl: GOOGLE_AUTH_URL, tokenUrl: GOOGLE_TOKEN_URL, scopes: [CALENDAR_SCOPE], pkce: true, extraAuthParams: GOOGLE_AUTH_PARAMS, clientIdEnv: GOOGLE_ENV.clientId, clientSecretEnv: GOOGLE_ENV.clientSecret },
  gate: "none",
  sandbox: { supported: true, howTo: "google-calendar.sandbox" },
  capabilities: { inbound: true, outbound: true, webhooks: false },
  streams: [
    { key: STREAM_PULL, schedule: { cron: "*/15 * * * *", tz: "Asia/Kolkata" }, run: (ctx, cur) => run(ctx, cur, calendarPullStep) },
    { key: STREAM_PUSH, schedule: { cron: "*/15 * * * *", tz: "Asia/Kolkata" }, run: (ctx, cur) => run(ctx, cur, calendarPushStep) },
  ],
  pushes: [],
  defaultFieldMap: [],
  rate: { requestsPerMinute: 120, maxRetries: 4, baseDelayMs: 800, maxDelayMs: 30_000 },
  async test({ secrets }) {
    const g = calendarGatewayFor({ secrets, env: process.env as Env });
    const token = g.kind === "mock" ? "mock" : grantFor(secrets)?.access ?? secrets.access_token;
    if (!token) throw new CredentialError("This Google connection has no access token. Reconnect to continue.");
    const p = await g.profile(token);
    return { accountId: p.email || undefined, accountLabel: p.email || undefined };
  },
  async refresh({ secrets }) { return refreshAllGrants({ secrets, env: process.env as Env }); },
};

export const isCalendarShowcase = (secrets: ConnectionSecrets, env: Env): boolean => isMockCredentials(secrets) || env.APP_ENV === "demo";
