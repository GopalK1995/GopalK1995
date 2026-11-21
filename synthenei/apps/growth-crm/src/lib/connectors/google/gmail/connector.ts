// ConnectorDef for Gmail (id `gmail`), registered in src/lib/connectors/all.ts. RESTRICTED scope (gmail.readonly) plus gmail.send, per-user
// OAuth, enabled ONLY while the platform's Google OAuth app is in testing (or after CASA), and only after the tenant opts in (gate.ts).
// `requiredEnv` makes the connector "not configured" until the platform declares the app mode, so the generic connect flow stays shut
// by default. The runtime re-checks the gate on every sync and send, so a connection made around the gate never reads or sends.
import type { ConnectionSecrets, ConnectorDef, SyncContext } from "../../core/types";
import { CredentialError } from "../../core/types";
import { grantFor, refreshAllGrants } from "../calendar/grants";
import { GOOGLE_AUTH_PARAMS, GOOGLE_AUTH_URL, GOOGLE_ENV, GOOGLE_TOKEN_URL } from "../shared/constants";
import { isMockCredentials } from "../shared/mode";
import { gmailGatewayFor } from "./config";
import { GMAIL_CONNECTOR_ID, GMAIL_ENV, GMAIL_SCOPES, STREAM_THREADS } from "./constants";
import { gmailThreadsStep } from "./sync";
import type { GmailDeps } from "./store";

type Env = Record<string, string | undefined>;
export interface GmailRuntime { deps: GmailDeps; env: Env; fetchImpl?: typeof fetch }

let factory: (() => Promise<GmailRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setGmailRuntimeFactory(f: (() => Promise<GmailRuntime>) | null): void { factory = f; }
export async function gmailRuntime(): Promise<GmailRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).gmailRuntimeFromService();
}

async function threads(ctx: SyncContext, cursor: unknown) {
  const rt = await gmailRuntime(), secrets = await ctx.secrets();
  return gmailThreadsStep({ deps: rt.deps, conn: ctx.conn, secrets, env: rt.env, gateway: gmailGatewayFor({ secrets, env: rt.env, fetchImpl: rt.fetchImpl }), reject: (r) => ctx.reject?.(r) }, cursor);
}

export const gmailConnector: ConnectorDef = {
  id: GMAIL_CONNECTOR_ID, name: "Gmail", category: "email", auth: "oauth2",
  oauth: { authorizeUrl: GOOGLE_AUTH_URL, tokenUrl: GOOGLE_TOKEN_URL, scopes: [GMAIL_SCOPES.read, GMAIL_SCOPES.send], pkce: true, extraAuthParams: GOOGLE_AUTH_PARAMS, clientIdEnv: GOOGLE_ENV.clientId, clientSecretEnv: GOOGLE_ENV.clientSecret },
  gate: "needs_vendor_approval",
  requiredEnv: [GMAIL_ENV.appMode],
  sandbox: { supported: true, howTo: "gmail.sandbox" },
  capabilities: { inbound: true, outbound: true, webhooks: false },
  streams: [{ key: STREAM_THREADS, schedule: { cron: "*/15 * * * *", tz: "Asia/Kolkata" }, run: threads }],
  pushes: [],
  defaultFieldMap: [],
  rate: { requestsPerMinute: 120, maxRetries: 4, baseDelayMs: 800, maxDelayMs: 30_000 },
  async test({ secrets }) {
    const g = gmailGatewayFor({ secrets, env: process.env as Env });
    const token = g.kind === "mock" ? "mock" : grantFor(secrets)?.access ?? secrets.access_token;
    if (!token) throw new CredentialError("This Google connection has no access token. Reconnect to continue.");
    const p = await g.profile(token);
    return { accountId: p.email || undefined, accountLabel: p.email || undefined };
  },
  async refresh({ secrets }) { return refreshAllGrants({ secrets, env: process.env as Env }); },
};

export const isGmailShowcase = (secrets: ConnectionSecrets, env: Env): boolean => isMockCredentials(secrets) || env.APP_ENV === "demo";
