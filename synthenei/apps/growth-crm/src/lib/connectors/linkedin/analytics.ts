// Ad analytics: daily spend / impressions / clicks / leads per campaign into campaign_daily_metrics. Pure normalisation (cost, currency,
// counts) plus the stream step. Idempotent (upsert on campaign + day), re-reads the trailing days because LinkedIn restates figures, and
// never invents a number: an unparseable row is rejected, not zeroed. Non-INR accounts need the tenant's own rate (settings.fx_to_inr).
import { CredentialError, type ConnectionRow, type ConnectionSecrets, type SyncResult } from "../core/types";
import { ANALYTICS_AFTER_HOUR_IST, ANALYTICS_BACKFILL_DAYS, ANALYTICS_LOOKBACK_DAYS, CAMPAIGN_URN_PREFIX, CRED, SCOPES, TOKEN_WARN_DAYS } from "./constants";
import type { LinkedInGateway, RawAnalytics } from "./gateway";
import { accountUrnOf, scopeOf } from "./leads";
import type { DailyMetricRow, LinkedInDeps } from "./store";

export type AnalyticsReject = "bad_day" | "no_campaign" | "bad_spend" | "currency_unconvertible";
export type Normalised = { ok: true; row: Omit<DailyMetricRow, "campaignId"> } | { ok: false; reason: AnalyticsReject };

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

/** Spend in the account's currency -> INR (paise precision). INR passes through; another currency needs the tenant's rate, otherwise null. */
export function spendInr(spend: unknown, currency: string | undefined, fx: Record<string, number>): number | null {
  const n = num(spend);
  if (n === null || n < 0) return null;
  const cur = (currency ?? "").toUpperCase();
  const rate = cur === "INR" ? 1 : fx[cur];
  if (!rate) return null;
  return Math.round(n * rate * 100) / 100;
}

const pad = (n: number) => String(n).padStart(2, "0");
export function normaliseAnalytics(raw: RawAnalytics, currency: string | undefined, fx: Record<string, number>): Normalised {
  const s = raw.dateRange?.start;
  const day = s && Number.isInteger(s.year) && Number.isInteger(s.month) && Number.isInteger(s.day) ? `${s.year}-${pad(s.month as number)}-${pad(s.day as number)}` : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return { ok: false, reason: "bad_day" };
  const urn = raw.pivotValues?.[0] ?? "", externalCampaignId = urn.startsWith(CAMPAIGN_URN_PREFIX) && /^\d{1,20}$/.test(urn.slice(CAMPAIGN_URN_PREFIX.length)) ? urn.slice(CAMPAIGN_URN_PREFIX.length) : "";
  if (!externalCampaignId) return { ok: false, reason: "no_campaign" };
  const sp = num(raw.costInLocalCurrency);
  if (sp === null || sp < 0) return { ok: false, reason: "bad_spend" };
  const inr = spendInr(raw.costInLocalCurrency, currency, fx);
  if (inr === null) return { ok: false, reason: "currency_unconvertible" };
  return { ok: true, row: { externalCampaignId, day, spendInr: inr, impressions: count(raw.impressions), clicks: count(raw.clicks), platformLeads: count(raw.oneClickLeads) } };
}

// ---- dates (IST) ----
const IST_MS = 330 * 60_000, DAY_MS = 86400e3;
export const istDay = (d: Date): string => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
export const istHour = (d: Date): number => new Date(d.getTime() + IST_MS).getUTCHours();
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Window to load: up to yesterday (IST) once the day has reached the sync hour, else up to the day before. Null = already current. */
export function planWindow(now: Date, through: string | undefined): { since: string; until: string } | null {
  const today = istDay(now), until = addDays(today, istHour(now) >= ANALYTICS_AFTER_HOUR_IST ? -1 : -2);
  if (through && through >= until) return null;
  const since = through ? addDays(through, -(ANALYTICS_LOOKBACK_DAYS - 1)) : addDays(until, -(ANALYTICS_BACKFILL_DAYS - 1));
  return since <= until ? { since, until } : null;
}

export interface StreamCtx { deps: LinkedInDeps; conn: ConnectionRow; secrets: ConnectionSecrets; gateway: LinkedInGateway; reject: (reason: string) => void }

export async function analyticsStep(c: StreamCtx, cursorIn: unknown): Promise<SyncResult> {
  const through = cursorIn && typeof cursorIn === "object" && typeof (cursorIn as { through?: unknown }).through === "string" ? (cursorIn as { through: string }).through : undefined;
  const accountId = c.secrets[CRED.adAccountId], urn = accountUrnOf(c.secrets);
  if (!accountId || !urn) return { cursor: { through }, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_ad_account" } };
  const win = planWindow(c.deps.now(), through);
  if (!win) return { cursor: { through }, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "up_to_date" } };

  const [raw, currency, names] = [await c.gateway.analytics({ accountUrn: urn, since: win.since, until: win.until }), await c.gateway.accountCurrency(accountId), await c.gateway.campaignNames(accountId)];
  const fx = fxRatesOf(c.conn.settings), campaigns = new Map<string, string>(), rows: DailyMetricRow[] = [];
  let rejected = 0;
  for (const r of raw) {
    const n = normaliseAnalytics(r, currency, fx);
    if (!n.ok) { rejected++; c.reject(n.reason); continue; }
    let campaignId = campaigns.get(n.row.externalCampaignId);
    if (!campaignId) {
      const real = names.get(n.row.externalCampaignId);
      campaignId = await c.deps.store.ensureCampaign({ tenantId: c.conn.tenantId, workspaceId: c.conn.workspaceId, externalId: n.row.externalCampaignId, name: real ?? `LinkedIn campaign ${n.row.externalCampaignId}`, placeholder: !real, synthetic: c.gateway.kind === "mock" });
      campaigns.set(n.row.externalCampaignId, campaignId);
    }
    rows.push({ ...n.row, campaignId });
  }
  if (rows.length) await c.deps.store.upsertDailyMetrics(rows, { ...scopeOf(c.conn), source: c.gateway.kind === "mock" ? "mock" : "api" });
  return { cursor: { through: win.until }, rowsIn: rows.length, rowsRejected: rejected, done: true, sample: { days: `${win.since}..${win.until}`, rows: rows.length, mode: c.gateway.kind } };
}

// ---- token health (once per IST day) ----
export type TokenState = "ok" | "expiring" | "expired" | "unknown";
/** Classifies an access token's expiry (ISO string from integrations.token_expires_at). No expiry recorded = unknown (not alarming). */
export function tokenState(expiresAt: string | null | undefined, now: Date, warnDays = TOKEN_WARN_DAYS): TokenState {
  if (!expiresAt) return "unknown";
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return "unknown";
  const left = t - now.getTime();
  return left <= 0 ? "expired" : left < warnDays * DAY_MS ? "expiring" : "ok";
}

export async function healthStep(c: StreamCtx, cursorIn: unknown): Promise<SyncResult> {
  const now = c.deps.now(), day = istDay(now);
  const last = cursorIn && typeof cursorIn === "object" ? (cursorIn as { day?: string }).day : undefined;
  if (last === day) return { cursor: { day }, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "checked_today" } };
  // An expired token is the owner's to fix (reconnect): needs_attention, never silent.
  if (tokenState(c.conn.tokenExpiresAt, now) === "expired") throw new CredentialError("The LinkedIn access token has expired");
  const t = await c.gateway.introspect();
  if (!t.active) throw new CredentialError("LinkedIn says this access token is no longer valid");
  const missing = SCOPES.filter((s) => t.scopes.length > 0 && !t.scopes.includes(s));
  const expiry = t.expiresAt ? new Date(t.expiresAt * 1000).toISOString() : c.conn.tokenExpiresAt;
  const daysLeft = expiry ? Math.floor((Date.parse(expiry) - now.getTime()) / DAY_MS) : null;
  return { cursor: { day }, rowsIn: 0, rowsRejected: 0, done: true, sample: { valid: true, days_left: daysLeft, state: tokenState(expiry, now), missing_scopes: missing, mode: c.gateway.kind } };
}
