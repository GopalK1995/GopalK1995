// ConnectorDef for Zoho CRM: OAuth (accounts server of the connection's data centre, India .in by default), initial import and
// incremental two-way sync through the shared engine (engine/), notifications where Zoho offers them, daily watch renewal.
// Registered in src/lib/connectors/all.ts. Streams: pull (every 15 min), push (every 15 min, offset), health (hourly slot, renews the watch).
import { saveSecrets } from "../core/secrets";
import type { ConnectionSecrets, ConnectorDef, StreamDef, SyncContext, SyncResult } from "../core/types";
import { CredentialError } from "../core/types";
import type { VaultPort } from "../core/ports";
import { makeZohoGateway } from "./api";
import { accountsUrlOf, apiBaseOf } from "./config";
import { CRED, OAUTH_PATHS, REGIONS, SCOPES, WEBHOOK_KEYS, WATCH_RENEW_BEFORE_HOURS, ZOHO_CONNECTOR_ID, isRegion, ZOHO_ENV, ZOHO_VENDOR_KEY } from "./constants";
import { ZOHO_DEFAULT_MAP } from "./defaults";
import { applyIds, crmStreams, type CrmRuntime, type VendorKit } from "./engine/kit";
import { optionsOf } from "./engine/types";
import { refreshZohoToken } from "./token";
import { channelIdFor, newWebhookSecret, parseZohoWebhook, registerWatch, type ZohoEvent } from "./webhook";

type Env = Record<string, string | undefined>;
export interface ZohoRuntime extends CrmRuntime { vault: VaultPort }

let factory: (() => Promise<ZohoRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setZohoRuntimeFactory(f: (() => Promise<ZohoRuntime>) | null): void { factory = f; }
async function runtime(): Promise<ZohoRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).zohoRuntime();
}

export const zohoKit: VendorKit = {
  vendorKey: ZOHO_VENDOR_KEY, defaultMap: ZOHO_DEFAULT_MAP,
  gatewayFor: ({ http, env, secrets }) => makeZohoGateway({ http, apiBase: apiBaseOf(secrets, env), token: secrets[CRED.accessToken] ?? "" }),
};

/** The daily slot renews the notification channel (they live at most a week). Polling keeps the data current without it. */
export async function healthStep(rt: ZohoRuntime, ctx: SyncContext, secrets: ConnectionSecrets, now = rt.now()): Promise<SyncResult> {
  const result = (sample: unknown): SyncResult => ({ cursor: null, rowsIn: 0, rowsRejected: 0, done: true, sample });
  const base = (rt.env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!base) return result({ watch: "skipped_no_app_base_url" });
  const conn = ctx.conn;
  let bundle: Record<string, string> = {};
  if (conn.webhookSecretId) { try { bundle = JSON.parse((await rt.vault.getSecret(conn.webhookSecretId)) ?? "{}") as Record<string, string>; } catch { bundle = {}; } }
  const expires = bundle[WEBHOOK_KEYS.channelExpires] ? Date.parse(bundle[WEBHOOK_KEYS.channelExpires]) : 0;
  if (bundle[WEBHOOK_KEYS.secret] && expires - now.getTime() > WATCH_RENEW_BEFORE_HOURS * 3_600_000) return result({ watch: "ok" });
  const secret = bundle[WEBHOOK_KEYS.secret] || newWebhookSecret();
  try {
    const w = await registerWatch({ http: ctx.http, apiBase: apiBaseOf(secrets, rt.env), token: secrets[CRED.accessToken] ?? "", conn, notifyUrl: `${base}/api/hooks/${ZOHO_CONNECTOR_ID}/${conn.id}`, secret, objects: optionsOf(conn.settings).objects, now });
    const id = await saveSecrets(rt.vault, conn.id, { [WEBHOOK_KEYS.secret]: secret, [WEBHOOK_KEYS.channelExpires]: w.expiresAt }, conn.webhookSecretId, "webhook");
    await rt.store.core.updateConnection(conn.id, { webhookSecretId: id });
    return result({ watch: "renewed" });
  } catch (e) {
    if (e instanceof CredentialError) throw e;
    ctx.reject?.("watch_failed");
    return { cursor: null, rowsIn: 0, rowsRejected: 0, done: true, sample: { watch: "failed" } };
  }
}

async function onWebhook(ctx: SyncContext, evt: unknown): Promise<void> {
  const e = evt as ZohoEvent, rt = await runtime();
  if (e.channelId !== channelIdFor(ctx.conn.id)) { ctx.reject?.("channel_mismatch"); return; }   // tenant isolation: another connection's channel
  if (e.operation === "delete") { ctx.reject?.("remote_deleted"); return; }                       // a delete at Zoho never deletes a CRM record
  await applyIds(rt, zohoKit, ctx, e.object, e.ids);
}

const streams: StreamDef[] = [
  ...crmStreams(zohoKit, runtime),
  { key: "health", schedule: { cron: "40 * * * *", tz: "Asia/Kolkata" }, run: async (ctx) => { const rt = await runtime(); return healthStep(rt, ctx, await ctx.secrets()); } },
];

/** Default OAuth endpoints: the deployment's data centre (ZOHO_ACCOUNTS_URL, or .in). The OAuth routes use these two static URLs. */
const accountsAtLoad = accountsUrlOf({}, typeof process !== "undefined" ? (process.env as Env) : {});

export const zohoConnector: ConnectorDef = {
  id: ZOHO_CONNECTOR_ID, name: "Zoho CRM", category: "crm", auth: "oauth2",
  oauth: {
    authorizeUrl: `${accountsAtLoad}${OAUTH_PATHS.authorize}`, tokenUrl: `${accountsAtLoad}${OAUTH_PATHS.token}`, scopes: [...SCOPES], pkce: false,
    extraAuthParams: { access_type: "offline", prompt: "consent" }, clientIdEnv: ZOHO_ENV.clientId, clientSecretEnv: ZOHO_ENV.clientSecret,
  },
  gate: "needs_client_credentials",
  sandbox: { supported: true, howTo: "zoho-crm.sandbox" },
  capabilities: { inbound: true, outbound: true, webhooks: true },
  streams, pushes: [],
  webhook: {
    // The edge verified the signature/token (verify/receive.ts); this parses the delivery and re-checks the body token when one is known.
    async verify(req, secrets) { return parseZohoWebhook(req.rawBody, secrets[WEBHOOK_KEYS.secret] ?? secrets.webhook_secret ?? null); },
    handle: onWebhook,
  },
  defaultFieldMap: ZOHO_DEFAULT_MAP,
  rate: { requestsPerMinute: 100, maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 30_000 },
  requiredEnv: [ZOHO_ENV.clientId, ZOHO_ENV.clientSecret],
  apiBaseEnv: ZOHO_ENV.apiBase, defaultApiBase: "https://www.zohoapis.in",
  async test({ secrets, http, apiBase }) {
    // The region stored on the connection decides the API domain unless the deployment overrides the base (stub).
    const region = secrets[CRED.region];
    const base = isRegion(region) && apiBase === "https://www.zohoapis.in" ? REGIONS[region].api : apiBase;
    const res = await http.json<{ org?: { id?: string; company_name?: string }[] } | undefined>({ method: "GET", url: `${base.replace(/\/+$/, "")}/crm/v6/org`, headers: { authorization: `Zoho-oauthtoken ${secrets[CRED.accessToken] ?? ""}` } });
    const o = res?.org?.[0];
    return { accountId: o?.id ? String(o.id) : undefined, accountLabel: o?.company_name };
  },
  async refresh({ secrets }) { return refreshZohoToken({ secrets, env: process.env as Env }); },
};

