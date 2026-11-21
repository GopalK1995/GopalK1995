// ConnectorDef for HubSpot: OAuth, initial import and incremental two-way sync through the shared engine (zoho/engine), webhooks
// (app-level subscriptions, v3 signature). Registered in src/lib/connectors/all.ts. Streams: pull and push, every 15 minutes.
import type { ConnectorDef, StreamDef, SyncContext } from "../core/types";
import { CredentialError } from "../core/types";
import { applyIds, crmStreams, type CrmRuntime, type VendorKit } from "../zoho/engine/kit";
import { CRM_OBJECTS, optionsOf, type CrmObject, type SyncOptions } from "../zoho/engine/types";
import { makeHubspotGateway } from "./api";
import { CRED, DEFAULT_API_BASE, HUBSPOT_CONNECTOR_ID, HUBSPOT_ENV, HUBSPOT_VENDOR_KEY, OAUTH_AUTHORIZE_URL, OAUTH_TOKEN_PATH, SCOPES } from "./constants";
import { HUBSPOT_DEFAULT_MAP, hubspotDefaultMap } from "./defaults";
import { parseHubspotWebhook, type HubspotEvent } from "./webhook";

export type HubspotRuntime = CrmRuntime;
let factory: (() => Promise<HubspotRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setHubspotRuntimeFactory(f: (() => Promise<HubspotRuntime>) | null): void { factory = f; }
async function runtime(): Promise<HubspotRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).hubspotRuntime();
}

/** HubSpot has one people object: contacts land as leads (default) or as contacts, never both. */
export const objectsFor = (o: SyncOptions): CrmObject[] => {
  const people = o.objects.some((x) => x === "lead" || x === "contact") ? o.contactTarget : null;
  return CRM_OBJECTS.filter((x) => (x === "lead" || x === "contact" ? x === people : o.objects.includes(x)));
};

export const hubspotKit: VendorKit = {
  vendorKey: HUBSPOT_VENDOR_KEY, defaultMap: (o) => hubspotDefaultMap(o.contactTarget), objectsFor,
  gatewayFor: ({ http, apiBase, secrets }) => makeHubspotGateway({ http, apiBase, token: secrets[CRED.accessToken] ?? "" }),
};

async function onWebhook(ctx: SyncContext, evt: unknown): Promise<void> {
  const e = evt as HubspotEvent, rt = await runtime(), secrets = await ctx.secrets();
  if (!secrets[CRED.hubId]) { ctx.reject?.("portal_unbound"); return; }
  if (e.portalId !== secrets[CRED.hubId]) { ctx.reject?.("portal_mismatch"); return; }   // tenant isolation: another portal's event
  if (e.operation === "delete") { ctx.reject?.("remote_deleted"); return; }              // a delete or merge at HubSpot never deletes a CRM record
  const target = optionsOf(ctx.conn.settings).contactTarget;
  const object: CrmObject = e.kind === "contacts" ? target : e.kind === "companies" ? "account" : "deal";
  await applyIds(rt, hubspotKit, ctx, object, [e.objectId]);
}

const streams: StreamDef[] = crmStreams(hubspotKit, runtime);
/** Default token endpoint: the deployment's API base (HUBSPOT_API_BASE for a stub, else api.hubapi.com). The OAuth routes use this static URL. */
const apiAtLoad = ((typeof process !== "undefined" ? process.env[HUBSPOT_ENV.apiBase] : "") ?? "").trim().replace(/\/+$/, "") || DEFAULT_API_BASE;

export const hubspotConnector: ConnectorDef = {
  id: HUBSPOT_CONNECTOR_ID, name: "HubSpot", category: "crm", auth: "oauth2",
  oauth: { authorizeUrl: OAUTH_AUTHORIZE_URL, tokenUrl: `${apiAtLoad}${OAUTH_TOKEN_PATH}`, scopes: [...SCOPES], pkce: false, clientIdEnv: HUBSPOT_ENV.clientId, clientSecretEnv: HUBSPOT_ENV.clientSecret },
  gate: "needs_client_credentials",
  sandbox: { supported: true, howTo: "hubspot.sandbox" },
  capabilities: { inbound: true, outbound: true, webhooks: true },
  streams, pushes: [],
  webhook: {
    // The edge verified the v3 signature on the raw body (verify/hubspot.ts); this only parses it.
    async verify(req) { return parseHubspotWebhook(req.rawBody); },
    handle: onWebhook,
  },
  defaultFieldMap: HUBSPOT_DEFAULT_MAP,
  rate: { requestsPerMinute: 300, maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 30_000 },
  requiredEnv: [HUBSPOT_ENV.clientId, HUBSPOT_ENV.clientSecret],
  apiBaseEnv: HUBSPOT_ENV.apiBase, defaultApiBase: DEFAULT_API_BASE,
  async test({ secrets, http, apiBase }) {
    const token = secrets[CRED.accessToken] ?? "";
    if (!token) throw new CredentialError("HubSpot credentials are incomplete");
    const info = await http.json<{ hub_id?: number | string; hub_domain?: string } | undefined>({ method: "GET", url: `${apiBase.replace(/\/+$/, "")}/oauth/v1/access-tokens/${encodeURIComponent(token)}` });
    return { accountId: info?.hub_id !== undefined ? String(info.hub_id) : undefined, accountLabel: info?.hub_domain };
  },
  // refresh: the framework default (grant_type=refresh_token against oauth.tokenUrl) matches HubSpot; its refresh tokens neither rotate nor expire.
};
