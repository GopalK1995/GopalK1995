// ConnectorDef for the WhatsApp Cloud API (registered in src/lib/connectors/all.ts).
// Manual connection: the tenant pastes WABA id, phone number id, a system-user token and the Meta app secret; they are verified
// with one Graph call (or the mock gateway for the documented sandbox token) and stored in the Vault by the framework lifecycle.
// Embedded signup produces the same bundle (see embedded.ts). Streams: template sync and the outbound dispatcher. Webhook: the
// parsed, already-signature-verified delivery goes through inbound.ts.
import type { ConnectorDef, ConnectionRow, ConnectionSecrets, StreamDef, SyncContext, SyncResult } from "../core/types";
import { CredentialError } from "../core/types";
import { CRED, DEFAULT_API_BASE, WA_CONNECTOR_ID, WA_ENV } from "./constants";
import { gatewayFor, isMockCredentials } from "./config";
import type { WhatsAppGateway } from "./gateway";
import { handleEvent, ownsNumber, scopeOf } from "./inbound";
import { dispatchQueued } from "./outbound";
import { parseWebhook, type WaEvent } from "./payload";
import type { WaDeps } from "./store";
import { syncTemplates } from "./templates";

type Env = Record<string, string | undefined>;
export interface WaRuntime { deps: WaDeps; env: Env; fetchImpl?: typeof fetch }

let factory: (() => Promise<WaRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setWaRuntimeFactory(f: (() => Promise<WaRuntime>) | null): void { factory = f; resetRegistered(); }
async function runtime(): Promise<WaRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).whatsappRuntime();
}
const gw = (rt: WaRuntime, conn: ConnectionRow, secrets: ConnectionSecrets): WhatsAppGateway => gatewayFor({ connectionId: conn.id, secrets, env: rt.env, fetchImpl: rt.fetchImpl });

const registered = new Set<string>();
const resetRegistered = (): void => registered.clear();

/** Records phone_number_id -> workspace (globally unique in the DB). False when another workspace already owns the number. */
export async function ensureRegistered(rt: WaRuntime, conn: ConnectionRow, secrets: ConnectionSecrets, info: { displayNumber?: string; verifiedName?: string; quality?: "green" | "yellow" | "red" | "unknown"; tier?: string }): Promise<boolean> {
  const phoneNumberId = secrets[CRED.phoneNumberId], wabaId = secrets[CRED.wabaId];
  if (!phoneNumberId || !wabaId) return false;
  const key = `${conn.id}:${phoneNumberId}:${info.displayNumber ?? ""}`;
  if (registered.has(key)) return true;
  const r = await rt.deps.store.upsertNumber({ ...scopeOf(conn), wabaId, phoneNumberId, displayNumber: info.displayNumber ?? "unknown", verifiedName: info.verifiedName, quality: info.quality ?? "unknown", messagingLimitTier: info.tier });
  if (r.ok) registered.add(key);
  return r.ok;
}

async function templatesStream(ctx: SyncContext): Promise<SyncResult> {
  const rt = await runtime(), secrets = await ctx.secrets(), g = gw(rt, ctx.conn, secrets);
  const phone = await g.getPhoneNumber();
  if (!(await ensureRegistered(rt, ctx.conn, secrets, { displayNumber: phone.displayNumber, verifiedName: phone.verifiedName, quality: phone.quality, tier: phone.messagingLimitTier }))) {
    throw new CredentialError("This WhatsApp number is already connected to another workspace");
  }
  let rejected = 0;
  const r = await syncTemplates(rt.deps, scopeOf(ctx.conn), await g.listTemplates(), (reason) => { rejected++; ctx.reject?.(reason); });
  return { cursor: null, rowsIn: r.created + r.updated, rowsRejected: rejected, done: true, sample: { templates: r.created + r.updated, mode: g.kind } };
}

async function dispatchStream(ctx: SyncContext): Promise<SyncResult> {
  const rt = await runtime(), secrets = await ctx.secrets(), g = gw(rt, ctx.conn, secrets);
  let rejected = 0;
  const s = await dispatchQueued(rt.deps, ctx.conn, g, (reason) => { rejected++; ctx.reject?.(reason); });
  return { cursor: null, rowsIn: s.sent, rowsRejected: rejected, done: true, sample: { sent: s.sent, blocked: s.blocked, failed: s.failed, retry: s.retry, mode: g.kind } };
}

const streams: StreamDef[] = [
  { key: "templates", schedule: { cron: "17 */6 * * *", tz: "Asia/Kolkata" }, run: (ctx) => templatesStream(ctx) },
  { key: "dispatch", schedule: { cron: "*/15 * * * *", tz: "Asia/Kolkata" }, run: (ctx) => dispatchStream(ctx) },
];

export const whatsappConnector: ConnectorDef = {
  id: WA_CONNECTOR_ID, name: "WhatsApp Business", category: "messaging", auth: "api_key",
  credentialFields: [
    { key: CRED.wabaId, label: "WhatsApp Business Account ID", secret: false, pattern: "^\\d{5,32}$" },
    { key: CRED.phoneNumberId, label: "Phone number ID", secret: false, pattern: "^\\d{5,32}$" },
    { key: CRED.accessToken, label: "System user access token", secret: true },
    { key: CRED.appSecret, label: "Meta app secret (signs webhooks)", secret: true },
  ],
  gate: "needs_vendor_approval",
  sandbox: { supported: true, howTo: "whatsapp.sandbox" },
  capabilities: { inbound: true, outbound: true, webhooks: true },
  streams, pushes: [],
  webhook: {
    // The edge already verified X-Hub-Signature-256 on the raw body (verify/receive.ts); this only parses it.
    async verify(req) { return parseWebhook(req.rawBody); },
    async handle(ctx, evt) {
      const e = evt as WaEvent, rt = await runtime(), secrets = await ctx.secrets();
      if (e.kind !== "template_status") {
        if (!ownsNumber(secrets, e.phoneNumberId)) { ctx.reject?.("phone_number_mismatch"); return; }
        const display = e.kind === "message" ? e.displayPhone : undefined;
        if (!(await ensureRegistered(rt, ctx.conn, secrets, { displayNumber: display }))) { ctx.reject?.("phone_number_taken"); return; }
      }
      await handleEvent({ deps: rt.deps, conn: ctx.conn, secrets, gateway: () => gw(rt, ctx.conn, secrets), reject: (r) => ctx.reject?.(r) }, e);
    },
  },
  defaultFieldMap: [],
  rate: { requestsPerMinute: 600, maxRetries: 4, baseDelayMs: 500, maxDelayMs: 20_000 },
  apiBaseEnv: WA_ENV.apiBase, defaultApiBase: DEFAULT_API_BASE,
  async test({ conn, secrets }) {
    const env = process.env as Env;
    const g = gatewayFor({ connectionId: conn.id, secrets, env });
    const p = await g.getPhoneNumber();
    return { accountId: secrets[CRED.phoneNumberId], accountLabel: p.verifiedName ?? p.displayNumber };
  },
};

/** Convenience for the UI layer: true when this connection runs on the sandbox gateway (shows the Showcase label). */
export function isShowcaseConnection(secrets: ConnectionSecrets, env: Env): boolean { return isMockCredentials(secrets) || env.APP_ENV === "demo"; }
