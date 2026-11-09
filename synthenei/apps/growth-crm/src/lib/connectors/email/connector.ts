// ConnectorDefs for outbound email: `resend` (the tenant's own Resend account) and `email-smtp` (the tenant's own mail server).
// Credentials are verified with one call and stored encrypted by the framework lifecycle; the Resend webhook signing secret is added
// afterwards on /settings/email (Resend only reveals it once the endpoint exists, which needs this connection's id). Sender name,
// address, reply-to and footer live in the connection settings, never in code. Streams: the queued-message dispatcher and the
// sending-domain re-check. Gmail restricted scopes are not used for sending.
import type { ConnectionRow, ConnectionSecrets, ConnectorDef, StreamDef, SyncContext, SyncResult } from "../core/types";
import { CRED, RESEND_CONNECTOR_ID, SMTP_CONNECTOR_ID, DEFAULT_RESEND_BASE, EMAIL_ENV } from "./constants";
import { transportFor } from "./config";
import { checkSendingDomain } from "./domain";
import type { EmailDeps } from "./store";
import { dispatchQueued } from "./send";
import type { EmailTransport } from "./transport";
import { handleEmailEvent, parseResendEvent, type ParsedEvent } from "./webhook";
import type { RuntimeDeps } from "../core/ports";

type Env = Record<string, string | undefined>;
export interface EmailRuntime { deps: EmailDeps; env: Env; core: RuntimeDeps; fetchImpl?: typeof fetch }

let factory: (() => Promise<EmailRuntime>) | null = null;
/** Tests inject a runtime built on fakes; production lazily builds the service-role runtime (runtime.ts, server-only). */
export function setEmailRuntimeFactory(f: (() => Promise<EmailRuntime>) | null): void { factory = f; }
export async function emailRuntime(): Promise<EmailRuntime> {
  if (factory) return factory();
  return (await import("./runtime")).serviceEmailRuntime();
}
export const transportOf = (rt: EmailRuntime, conn: ConnectionRow, secrets: ConnectionSecrets): EmailTransport =>
  transportFor({ connectionId: conn.id, connectorId: conn.connectorId, secrets, env: rt.env, fetchImpl: rt.fetchImpl });

async function dispatchStream(ctx: SyncContext): Promise<SyncResult> {
  const rt = await emailRuntime(), secrets = await ctx.secrets(), t = transportOf(rt, ctx.conn, secrets);
  let rejected = 0;
  const s = await dispatchQueued(rt.deps, ctx.conn, t, (reason) => { rejected++; ctx.reject?.(reason); });
  return { cursor: null, rowsIn: s.sent, rowsRejected: rejected, done: true, sample: { sent: s.sent, blocked: s.blocked, failed: s.failed, retry: s.retry, mode: t.kind } };
}

/** Re-checks the sending domain and stores the result on the connection (health.domain). */
export async function refreshDomainState(rt: EmailRuntime, conn: ConnectionRow, secrets: ConnectionSecrets): Promise<{ status: string } | { skipped: string }> {
  const r = await checkSendingDomain(conn, transportOf(rt, conn, secrets), rt.deps.now());
  if (!r.ok) return { skipped: r.reason };
  await rt.core.store.updateConnection(conn.id, { health: { domain: r.state } });
  return { status: r.state.status };
}
async function domainStream(ctx: SyncContext): Promise<SyncResult> {
  const rt = await emailRuntime(), secrets = await ctx.secrets();
  const r = await refreshDomainState(rt, ctx.conn, secrets);
  return { cursor: null, rowsIn: "status" in r ? 1 : 0, rowsRejected: 0, done: true, sample: r };
}

const streams = (withDomain: boolean): StreamDef[] => [
  { key: "dispatch", schedule: { cron: "*/5 * * * *", tz: "Asia/Kolkata" }, run: (ctx) => dispatchStream(ctx) },
  ...(withDomain ? [{ key: "domain", schedule: { cron: "23 */6 * * *", tz: "Asia/Kolkata" as const }, run: (ctx: SyncContext) => domainStream(ctx) }] : []),
];

async function pingWith(connectorId: string, conn: ConnectionRow, secrets: ConnectionSecrets): Promise<void> {
  await transportFor({ connectionId: conn.id, connectorId, secrets, env: process.env as Env }).ping();
}

export const resendConnector: ConnectorDef = {
  id: RESEND_CONNECTOR_ID, name: "Email (Resend)", category: "email", auth: "api_key",
  credentialFields: [{ key: CRED.apiKey, label: "Resend API key", secret: true, pattern: "^re_[A-Za-z0-9_]{8,200}$" }],
  gate: "none",
  sandbox: { supported: true, howTo: "email.sandbox" },
  capabilities: { inbound: false, outbound: true, webhooks: true },
  streams: streams(true), pushes: [],
  webhook: {
    // The edge already verified svix-signature on the raw body (verify/receive.ts); this only parses it.
    async verify(req) { const e = parseResendEvent(req.rawBody); return e ? [e] : []; },
    async handle(ctx, evt) {
      await handleEmailEvent({ store: (await emailRuntime()).deps.store, scope: { tenantId: ctx.conn.tenantId, workspaceId: ctx.conn.workspaceId, connectionId: ctx.conn.id }, now: () => new Date(), reject: (r) => ctx.reject?.(r) }, evt as ParsedEvent);
    },
  },
  defaultFieldMap: [],
  rate: { requestsPerMinute: 120, maxRetries: 4, baseDelayMs: 500, maxDelayMs: 20_000 },
  apiBaseEnv: EMAIL_ENV.resendApiBase, defaultApiBase: DEFAULT_RESEND_BASE,
  async test({ conn, secrets }) { await pingWith(conn.connectorId, conn, secrets); return { accountLabel: "Resend" }; },
};

export const smtpConnector: ConnectorDef = {
  id: SMTP_CONNECTOR_ID, name: "Email (SMTP)", category: "email", auth: "api_key",
  credentialFields: [
    { key: CRED.smtpHost, label: "SMTP server", secret: false, pattern: "^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$" },
    { key: CRED.smtpPort, label: "Port (465 or 587)", secret: false, pattern: "^\\d{2,5}$" },
    { key: CRED.smtpUsername, label: "Username", secret: false },
    { key: CRED.smtpPassword, label: "Password", secret: true },
  ],
  gate: "none",
  sandbox: { supported: true, howTo: "email.sandbox" },
  // SMTP has no delivery callbacks: bounces from the receiving server arrive in the tenant's mailbox, not here. Refusals at send time are recorded.
  capabilities: { inbound: false, outbound: true, webhooks: false },
  streams: streams(true), pushes: [],
  defaultFieldMap: [],
  rate: { requestsPerMinute: 120, maxRetries: 2, baseDelayMs: 500, maxDelayMs: 10_000 },
  async test({ conn, secrets }) { await pingWith(conn.connectorId, conn, secrets); return { accountLabel: secrets[CRED.smtpHost], accountId: secrets[CRED.smtpUsername] }; },
};
