// ConnectorDef for Slack (alerts into one channel), registered in src/lib/connectors/all.ts.
// One OAuth connection (Slack v2, bot token) per workspace; after it, selectSlackChannel (assets.ts) picks the channel and alert switches.
// There are no streams: alerts are pushed by the slack.alert job (jobs.ts) when the event fan-out sees a matching event. Webhook: Slack's
// signed Events API deliveries (X-Slack-Signature, T023 receiver, scheme slack) only carry token revocation / app uninstall, which flips
// the connection to needs_attention immediately instead of at the next failed post.
import type { ConnectionSecrets, ConnectorDef } from "../core/types";
import { gatewayFor, isMockCredentials } from "./config";
import { CRED, DEFAULT_API_BASE, OAUTH_AUTHORIZE_URL, OAUTH_TOKEN_URL, SCOPES, SLACK_CONNECTOR_ID, SLACK_ENV } from "./constants";
import { flagNeedsAttention } from "./deliver";
import type { SlackDeps } from "./store";

type Env = Record<string, string | undefined>;

let factory: (() => Promise<{ deps: SlackDeps }>) | null = null;
/** Tests inject deps built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setSlackRuntimeFactory(f: (() => Promise<{ deps: SlackDeps }>) | null): void { factory = f; }
export async function slackRuntime(): Promise<{ deps: SlackDeps }> {
  if (factory) return factory();
  return (await import("./runtime")).slackRuntime();
}

export type SlackEvent = { kind: "revoked"; teamId: string; event: "tokens_revoked" | "app_uninstalled" } | { kind: "ignored" };

/** Parses a Slack Events API body. Only revocation events matter; everything else is ignored (never an error: Slack retries failures). */
export function parseSlackEvent(raw: string): SlackEvent[] {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return []; }
  const o = (j ?? {}) as { type?: unknown; team_id?: unknown; event?: { type?: unknown } };
  if (o.type !== "event_callback" || typeof o.team_id !== "string") return [{ kind: "ignored" }];
  const t = o.event?.type;
  return t === "tokens_revoked" || t === "app_uninstalled" ? [{ kind: "revoked", teamId: o.team_id, event: t }] : [{ kind: "ignored" }];
}

export const slackConnector: ConnectorDef = {
  id: SLACK_CONNECTOR_ID, name: "Slack", category: "automation", auth: "oauth2",
  // Slack takes bot scopes as a comma list in `scope`; extraAuthParams overrides the space-joined value the generic builder writes.
  oauth: { authorizeUrl: OAUTH_AUTHORIZE_URL, tokenUrl: OAUTH_TOKEN_URL, scopes: [...SCOPES], pkce: false, clientIdEnv: SLACK_ENV.clientId, clientSecretEnv: SLACK_ENV.clientSecret, extraAuthParams: { scope: SCOPES.join(",") } },
  gate: "needs_client_credentials",   // the platform Slack app (client id / secret) must exist; no Slack review is needed for a private or workspace app
  sandbox: { supported: true, howTo: "slack.sandbox" },
  capabilities: { inbound: false, outbound: true, webhooks: true },
  streams: [], pushes: [],
  webhook: {
    // The edge already verified X-Slack-Signature on the raw body (verify/receive.ts); this only parses it.
    async verify(req) { return parseSlackEvent(req.rawBody); },
    async handle(ctx, evt) {
      const e = evt as SlackEvent;
      if (e.kind !== "revoked") return;
      // The signing secret is shared by every tenant of the platform's Slack app, so the team in the body must be THIS connection's team.
      const secrets = await ctx.secrets();
      if (!secrets[CRED.teamId] || secrets[CRED.teamId] !== e.teamId) return;
      const { deps } = await slackRuntime();
      await flagNeedsAttention(deps, ctx.conn, "Slack access was revoked or the app was removed; reconnect Slack.", e.event);
    },
  },
  defaultFieldMap: [],
  rate: { requestsPerMinute: 50, maxRetries: 3, baseDelayMs: 500, maxDelayMs: 15_000 },
  requiredEnv: [SLACK_ENV.clientId, SLACK_ENV.clientSecret],
  apiBaseEnv: SLACK_ENV.apiBase, defaultApiBase: DEFAULT_API_BASE,
  async test({ conn, secrets }) {
    const info = await gatewayFor({ connectionId: conn.id, secrets, env: process.env as Env }).authTest();
    return { accountId: info.teamId || undefined, accountLabel: info.teamName || undefined };
  },
  // Slack bot tokens do not expire (no rotation enabled), so there is no refresh grant.
};

/** True when this connection runs on the sandbox gateway (shows the Showcase label). */
export function isShowcaseConnection(secrets: ConnectionSecrets, env: Env): boolean { return isMockCredentials(secrets) || env.APP_ENV === "demo"; }
