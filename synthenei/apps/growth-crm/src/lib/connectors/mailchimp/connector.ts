// ConnectorDef for Mailchimp (OAuth). Push: consented leads -> the tenant's chosen audience (tagged with the CRM segment name).
// Pull: unsubscribes and cleaned (bounced) members every 30 minutes, plus the webhook for immediacy; both write a consent
// withdrawal and a suppression row through the same function the email connector uses. Mailchimp tokens do not expire.
import type { ConnectorDef, StreamDef, SyncContext, SyncResult } from "../core/types";
import { CredentialError } from "../core/types";
import { emailRuntime } from "../email/connector";
import { suppressAddress } from "../email/withdraw";
import { mailchimpApi, resolveBase } from "./api";
import { CRED, DEFAULT_OAUTH_BASE, MAILCHIMP_CONNECTOR_ID, MC_ENV, PULL_PAGE, SET } from "./constants";
import { hookReason, parseMembers, parseWebhook, reasonForStatus, toMember, type McHook } from "./mapping";

export const audienceOf = (settings: Record<string, unknown>): string | null => { const v = settings[SET.audienceId]; return typeof v === "string" && /^[A-Za-z0-9]{4,40}$/.test(v) ? v : null; };

async function api(ctx: SyncContext) {
  const token = (await ctx.secrets())[CRED.accessToken];
  if (!token) throw new CredentialError("Mailchimp token missing");
  return mailchimpApi(ctx.http, await resolveBase(ctx.http, token, ctx.apiBase), token);
}

export interface PullCursor { since: string | null; phase: "unsubscribed" | "cleaned"; offset: number; startedAt: string | null }
const isCursor = (v: unknown): v is PullCursor => !!v && typeof v === "object" && "phase" in v && "offset" in v;

/** One page per call; the runner loops until done and stores the cursor after each page. `since` only moves when a whole pass finished. */
export async function pullPage(ctx: SyncContext, raw: unknown, now: () => Date = () => new Date()): Promise<SyncResult> {
  const audience = audienceOf(ctx.conn.settings);
  if (!audience) return { cursor: raw ?? null, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_audience" } };
  const cur: PullCursor = isCursor(raw) ? raw : { since: raw && typeof raw === "object" && "since" in raw ? String((raw as { since: unknown }).since) : null, phase: "unsubscribed", offset: 0, startedAt: null };
  const startedAt = cur.startedAt ?? now().toISOString();
  const rt = await emailRuntime(), a = await api(ctx);
  const page = parseMembers(await a.members(audience, cur.phase, cur.since, cur.offset, PULL_PAGE), cur.phase);
  let rows = 0, rejected = 0;
  for (const m of page.rows) {
    const reason = reasonForStatus(m.status);
    if (!reason) continue;
    try { await suppressAddress(rt.deps.store, { tenantId: ctx.conn.tenantId, workspaceId: ctx.conn.workspaceId, email: m.email, reason, source: "mailchimp_pull" }); rows++; }
    catch { rejected++; ctx.reject?.("suppress_failed"); }
  }
  const next = cur.offset + page.rows.length;
  if (page.rows.length === PULL_PAGE && next < page.total) return { cursor: { ...cur, offset: next, startedAt } satisfies PullCursor, rowsIn: rows, rowsRejected: rejected, done: false };
  if (cur.phase === "unsubscribed") return { cursor: { ...cur, phase: "cleaned", offset: 0, startedAt } satisfies PullCursor, rowsIn: rows, rowsRejected: rejected, done: false };
  return { cursor: { since: startedAt, phase: "unsubscribed", offset: 0, startedAt: null } satisfies PullCursor, rowsIn: rows, rowsRejected: rejected, done: true, sample: { pulled: rows } };
}

const streams: StreamDef[] = [{ key: "unsubscribes", schedule: { cron: "11,41 * * * *", tz: "Asia/Kolkata" }, run: (ctx, cursor) => pullPage(ctx, cursor) }];

export const mailchimpConnector: ConnectorDef = {
  id: MAILCHIMP_CONNECTOR_ID, name: "Mailchimp", category: "email", auth: "oauth2",
  oauth: { authorizeUrl: `${DEFAULT_OAUTH_BASE}/oauth2/authorize`, tokenUrl: `${DEFAULT_OAUTH_BASE}/oauth2/token`, scopes: [], pkce: false, clientIdEnv: MC_ENV.clientId, clientSecretEnv: MC_ENV.clientSecret },
  gate: "needs_client_credentials",
  sandbox: { supported: false, howTo: "mailchimp.sandbox" },
  capabilities: { inbound: true, outbound: true, webhooks: true },
  streams,
  pushes: [{
    key: "contacts", consentPurpose: "marketing_email",
    async run(ctx, input) {
      const audience = audienceOf(ctx.conn.settings);
      if (!audience) return { ok: false, error: "No Mailchimp audience chosen" };
      const rt = await emailRuntime();
      const rcpt = await rt.deps.store.getRecipient(ctx.conn.workspaceId, ctx.contactId);
      const tag = input && typeof input === "object" && typeof (input as { tag?: unknown }).tag === "string" ? (input as { tag: string }).tag : null;
      const member = rcpt ? toMember(rcpt, tag) : null;
      if (!member) return { ok: false, error: "The lead has no email address" };
      // Suppressed addresses are never pushed: a bounced or complained address must not re-enter an audience through us.
      if (await rt.deps.store.isSuppressed(ctx.conn.workspaceId, member.email_address)) return { ok: false, error: "Address is suppressed" };
      const r = await (await api(ctx)).putMember(audience, member);
      return { ok: true, externalId: r.id };
    },
  }],
  webhook: {
    // Mailchimp does not sign; the receiver compared the shared `k` secret (verify/mailchimp.ts). This only parses the form body.
    async verify(req) { return parseWebhook(req.rawBody); },
    async handle(ctx, evt) {
      const h = evt as McHook, audience = audienceOf(ctx.conn.settings);
      if (audience && h.listId && h.listId !== audience) { ctx.reject?.("other_audience"); return; }   // a list this connection does not sync
      await suppressAddress((await emailRuntime()).deps.store, { tenantId: ctx.conn.tenantId, workspaceId: ctx.conn.workspaceId, email: h.email, reason: hookReason(h), source: "mailchimp_webhook" });
    },
  },
  defaultFieldMap: [],
  rate: { requestsPerMinute: 300, maxRetries: 4, baseDelayMs: 500, maxDelayMs: 20_000 },
  apiBaseEnv: MC_ENV.apiBase,
  async test({ secrets, http, apiBase }) {
    const token = secrets[CRED.accessToken];
    if (!token) throw new CredentialError("Mailchimp token missing");
    const r = await mailchimpApi(http, await resolveBase(http, token, apiBase), token).ping();
    return { accountLabel: r.account };
  },
};
