// ConnectorDef for Outlook / Microsoft 365 (mail + calendar over Microsoft Graph), registered in src/lib/connectors/all.ts under the id
// `outlook`. One multi-tenant Entra ID app (delegated permissions, OAuth code + PKCE) serves every customer firm; a tenant admin can
// pre-approve it for the whole firm with the admin-consent link (consent.ts). Gated `needs_vendor_approval`: until the app's publisher is
// verified (Microsoft Partner Network) other tenants see an "unverified" consent and many cannot consent at all, so the connector runs
// on the Showcase gateway and a live connection reports the gate.
// Streams: inbox, sent (known contacts only), calendar (into calendar_events), subscriptions (hourly renewal of Graph change notifications).
import type { RuntimeDeps } from "../core/ports";
import { CredentialError, type ConnectorDef, type ConnectionRow, type ConnectionSecrets, type SyncContext } from "../core/types";
import { graphGatewayFor } from "./config";
import { MS_AUTHORIZE_URL, MS_ENV, MS_ID, MS_SCOPES, MS_TOKEN_URL, STREAM_CALENDAR, STREAM_INBOX, STREAM_SENT, STREAM_SUBSCRIPTIONS } from "./constants";
import type { GraphGateway } from "./gateway";
import { parseNotifications, type GraphEvent } from "./mappers";
import { calendarStep, mailStep, type MsStreamCtx } from "./sync";
import type { MsDeps } from "./store";
import { asSubCursor, ensureSubscriptions } from "./subscriptions";
import { refreshMicrosoftToken } from "./token";
import { handleGraphEvent } from "./webhook";

type Env = Record<string, string | undefined>;
export interface MsRuntime { deps: MsDeps; rd: RuntimeDeps; env: Env; fetchImpl?: typeof fetch }

let factory: (() => Promise<MsRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setMsRuntimeFactory(f: (() => Promise<MsRuntime>) | null): void { factory = f; }
export async function msRuntime(): Promise<MsRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).serviceMsRuntime();
}

async function gatewayFor(rt: MsRuntime, conn: ConnectionRow, secrets: ConnectionSecrets): Promise<GraphGateway> {
  return graphGatewayFor({ connectionId: conn.id, secrets, env: rt.env, fetchImpl: rt.fetchImpl });
}
const mail = (folder: "inbox" | "sent") => async (ctx: SyncContext, cursor: unknown) => {
  const rt = await msRuntime();
  const c: MsStreamCtx = { deps: rt.deps, conn: ctx.conn, gateway: await gatewayFor(rt, ctx.conn, await ctx.secrets()), reject: (r) => ctx.reject?.(r) };
  return mailStep(c, folder, cursor);
};

export const outlookConnector: ConnectorDef = {
  id: MS_ID, name: "Outlook / Microsoft 365", category: "email", auth: "oauth2",
  oauth: { authorizeUrl: MS_AUTHORIZE_URL, tokenUrl: MS_TOKEN_URL, scopes: [...MS_SCOPES], pkce: true, extraAuthParams: { response_mode: "query" }, clientIdEnv: MS_ENV.clientId, clientSecretEnv: MS_ENV.clientSecret },
  gate: "needs_vendor_approval",
  sandbox: { supported: true, howTo: "outlook.sandbox" },
  // Outbound = mail to known contacts through the explicit send action (actions.ts), never an automated push.
  capabilities: { inbound: true, outbound: true, webhooks: true },
  streams: [
    { key: STREAM_INBOX, schedule: { cron: "*/15 * * * *", tz: "Asia/Kolkata" }, run: mail("inbox") },
    { key: STREAM_SENT, schedule: { cron: "5-59/15 * * * *", tz: "Asia/Kolkata" }, run: mail("sent") },
    {
      key: STREAM_CALENDAR, schedule: { cron: "10-59/20 * * * *", tz: "Asia/Kolkata" },
      async run(ctx, cursor) {
        const rt = await msRuntime();
        return calendarStep({ deps: rt.deps, conn: ctx.conn, gateway: await gatewayFor(rt, ctx.conn, await ctx.secrets()), reject: (r) => ctx.reject?.(r) }, cursor);
      },
    },
    {
      key: STREAM_SUBSCRIPTIONS, schedule: { cron: "40 * * * *", tz: "Asia/Kolkata" },
      async run(ctx, cursor) {
        const rt = await msRuntime();
        const r = await ensureSubscriptions({ rd: rt.rd, deps: rt.deps, gateway: await gatewayFor(rt, ctx.conn, await ctx.secrets()), conn: ctx.conn, env: rt.env, cursor });
        return { cursor: r.cursor, rowsIn: r.created + r.renewed, rowsRejected: 0, done: true, sample: { status: r.cursor.status, created: r.created, renewed: r.renewed, ...(r.cursor.error ? { error: r.cursor.error } : {}) } };
      },
    },
  ],
  pushes: [],
  webhook: {
    // The receiver already verified clientState on the raw body (microsoft/validation.ts, registered as the `graph` scheme); this parses.
    async verify(req) { return parseNotifications(req.rawBody).events; },
    async handle(ctx, evt) {
      const rt = await msRuntime();
      await handleGraphEvent({ deps: rt.deps, conn: ctx.conn, gateway: await gatewayFor(rt, ctx.conn, await ctx.secrets()), reject: (r) => ctx.reject?.(r) }, evt as GraphEvent);
    },
  },
  defaultFieldMap: [],
  rate: { requestsPerMinute: 60, maxRetries: 4, baseDelayMs: 800, maxDelayMs: 30_000 },
  async test({ conn, secrets }) {
    const g = graphGatewayFor({ connectionId: conn.id, secrets, env: process.env as Env });
    const me = await g.profile();
    if (!me.mail && g.kind === "api") throw new CredentialError("This Microsoft account has no mailbox address");
    return { accountId: me.id, accountLabel: me.mail ?? me.name ?? undefined };
  },
  async refresh({ secrets }) { return refreshMicrosoftToken({ secrets, env: process.env as Env }); },
};

/** For the UI layer: the subscription health of a connection from its `subscriptions` stream cursor. */
export const subscriptionHealth = (cursor: unknown): { status: "active" | "no_public_url" | "error"; subscriptions: number } => {
  const c = asSubCursor(cursor);
  return { status: c.status, subscriptions: Object.keys(c.subs).length };
};
