// Ads Insights: daily campaign metrics into campaign_daily_metrics. Pure normalisation (cost, currency, counts) plus the stream
// step. The sync is resumable (cursor = last day loaded + the page being read), idempotent (upsert on campaign + day), re-reads
// the trailing days because Meta restates attribution, and never invents a number: an unparseable row is rejected, not zeroed.
import { CredentialError, type ConnectionRow, type ConnectionSecrets, type SyncResult } from "../core/types";
import { CRED, INSIGHTS_AFTER_HOUR_IST, INSIGHTS_BACKFILL_DAYS, INSIGHTS_LOOKBACK_DAYS, SCOPES, TOKEN_WARN_DAYS } from "./constants";
import type { MetaGateway, RawAction, RawInsight } from "./gateway";
import { scopeOf } from "./leads";
import type { DailyMetricRow, MetaDeps } from "./store";

export type InsightReject = "bad_day" | "no_campaign" | "bad_spend" | "currency_unconvertible";
export type Normalised = { ok: true; row: Omit<DailyMetricRow, "campaignId">; name: string } | { ok: false; reason: InsightReject };

/** settings.fx_to_inr = { "USD": 83.1 }: the tenant's own conversion rate to INR. Only positive finite numbers count. */
export function fxRatesOf(settings: Record<string, unknown>): Record<string, number> {
  const raw = settings.fx_to_inr, out: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) if (/^[A-Za-z]{3}$/.test(k) && typeof v === "number" && Number.isFinite(v) && v > 0) out[k.toUpperCase()] = v;
  return out;
}

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const count = (v: unknown): number => { const n = num(v); return n !== null && n > 0 ? Math.floor(n) : 0; };
const actionSum = (actions: RawAction[] | undefined, ...types: string[]): number => {
  for (const t of types) {
    const hits = (actions ?? []).filter((a) => a.action_type === t);
    if (hits.length) return hits.reduce((s, a) => s + count(a.value), 0);
  }
  return 0;   // the first type present wins, so lead and lead_grouped are never added together
};

/** Spend in the account's currency -> INR. INR passes through; another currency needs the tenant's rate, otherwise the row is rejected. */
export function spendInr(spend: unknown, currency: string | undefined, fx: Record<string, number>): number | null {
  const n = num(spend);
  if (n === null || n < 0) return null;
  const cur = (currency ?? "INR").toUpperCase();
  const rate = cur === "INR" ? 1 : fx[cur];
  if (!rate) return null;
  return Math.round(n * rate * 100) / 100;
}

export function normaliseInsight(raw: RawInsight, fx: Record<string, number>): Normalised {
  const day = raw.date_start ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return { ok: false, reason: "bad_day" };
  const externalCampaignId = typeof raw.campaign_id === "string" && /^[\w-]{1,64}$/.test(raw.campaign_id) ? raw.campaign_id : "";
  if (!externalCampaignId) return { ok: false, reason: "no_campaign" };
  const sp = num(raw.spend);
  if (sp === null || sp < 0) return { ok: false, reason: "bad_spend" };
  const inr = spendInr(raw.spend, raw.account_currency, fx);
  if (inr === null) return { ok: false, reason: "currency_unconvertible" };
  return {
    ok: true, name: (raw.campaign_name ?? "").trim() || `Campaign ${externalCampaignId}`,
    row: {
      externalCampaignId, day, spendInr: inr, impressions: count(raw.impressions), reach: count(raw.reach), clicks: count(raw.clicks),
      reactions: actionSum(raw.actions, "post_reaction"), comments: actionSum(raw.actions, "comment"), shares: actionSum(raw.actions, "post"),
      platformLeads: actionSum(raw.actions, "lead", "onsite_conversion.lead_grouped"),
    },
  };
}

// ---- dates (IST) ----
const IST_MS = 330 * 60_000, DAY_MS = 86400e3;
export const istDay = (d: Date): string => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
export const istHour = (d: Date): number => new Date(d.getTime() + IST_MS).getUTCHours();
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export interface InsightsCursor { through?: string; win?: { since: string; until: string; after?: string } }
const asCursor = (c: unknown): InsightsCursor => {
  const o = c && typeof c === "object" ? (c as InsightsCursor) : {};
  const win = o.win && typeof o.win.since === "string" && typeof o.win.until === "string" ? { since: o.win.since, until: o.win.until, after: typeof o.win.after === "string" ? o.win.after : undefined } : undefined;
  return { through: typeof o.through === "string" ? o.through : undefined, win };
};

/** Window to load: up to yesterday (IST) once the day has reached the sync hour, else up to the day before. Null = already current. */
export function planWindow(now: Date, through: string | undefined): { since: string; until: string } | null {
  const today = istDay(now), until = addDays(today, istHour(now) >= INSIGHTS_AFTER_HOUR_IST ? -1 : -2);
  if (through && through >= until) return null;
  const since = through ? addDays(through, -(INSIGHTS_LOOKBACK_DAYS - 1)) : addDays(until, -(INSIGHTS_BACKFILL_DAYS - 1));
  return since <= until ? { since, until } : null;
}

export interface StreamCtx { deps: MetaDeps; conn: ConnectionRow; secrets: ConnectionSecrets; gateway: MetaGateway; reject: (reason: string) => void }

export async function insightsStep(c: StreamCtx, cursorIn: unknown): Promise<SyncResult> {
  const cur = asCursor(cursorIn), adAccount = c.secrets[CRED.adAccountId];
  if (!adAccount) return { cursor: cur, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_ad_account" } };
  const win: { since: string; until: string; after?: string } | null = cur.win ?? planWindow(c.deps.now(), cur.through);
  if (!win) return { cursor: { through: cur.through }, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "up_to_date" } };

  const page = await c.gateway.insights({ adAccountId: adAccount, since: win.since, until: win.until, after: win.after });
  const fx = fxRatesOf(c.conn.settings), campaigns = new Map<string, string>(), rows: DailyMetricRow[] = [];
  let rejected = 0;
  for (const raw of page.rows) {
    const n = normaliseInsight(raw, fx);
    if (!n.ok) { rejected++; c.reject(n.reason); continue; }
    let campaignId = campaigns.get(n.row.externalCampaignId);
    if (!campaignId) {
      campaignId = await c.deps.store.ensureCampaign({ tenantId: c.conn.tenantId, workspaceId: c.conn.workspaceId, externalId: n.row.externalCampaignId, name: n.name, synthetic: c.gateway.kind === "mock" });
      campaigns.set(n.row.externalCampaignId, campaignId);
    }
    rows.push({ ...n.row, campaignId });
  }
  if (rows.length) await c.deps.store.upsertDailyMetrics(rows, { ...scopeOf(c.conn), source: c.gateway.kind === "mock" ? "mock" : "api" });
  const sample = { days: `${win.since}..${win.until}`, rows: rows.length, mode: c.gateway.kind };
  if (page.after) return { cursor: { through: cur.through, win: { ...win, after: page.after } }, rowsIn: rows.length, rowsRejected: rejected, done: false, sample };
  return { cursor: { through: win.until }, rowsIn: rows.length, rowsRejected: rejected, done: true, sample };
}

// ---- token health (once per IST day) ----
export type TokenState = "ok" | "expiring" | "expired" | "unknown";
/** Classifies a user token's expiry (ISO string from integrations.token_expires_at). No expiry recorded = unknown (not alarming). */
export function tokenState(expiresAt: string | null | undefined, now: Date, warnDays = TOKEN_WARN_DAYS): TokenState {
  if (!expiresAt) return "unknown";
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return "unknown";
  const left = t - now.getTime();
  return left <= 0 ? "expired" : left < warnDays * DAY_MS ? "expiring" : "ok";
}

export async function healthStep(c: StreamCtx, cursorIn: unknown): Promise<SyncResult> {
  const day = istDay(c.deps.now());
  const last = cursorIn && typeof cursorIn === "object" ? (cursorIn as { day?: string }).day : undefined;
  if (last === day) return { cursor: { day }, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "checked_today" } };
  const d = await c.gateway.debugToken();
  if (!d.valid) throw new CredentialError("Meta says this access token is no longer valid");   // -> needs_attention, visible to the owner
  const missing = SCOPES.filter((s) => d.scopes.length > 0 && !d.scopes.includes(s));
  const daysLeft = d.expiresAt && d.expiresAt > 0 ? Math.floor((d.expiresAt * 1000 - c.deps.now().getTime()) / DAY_MS) : null;
  return { cursor: { day }, rowsIn: 0, rowsRejected: 0, done: true, sample: { valid: true, days_left: daysLeft, missing_scopes: missing, mode: c.gateway.kind } };
}
