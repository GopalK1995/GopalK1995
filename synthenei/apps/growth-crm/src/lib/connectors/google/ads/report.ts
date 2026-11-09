// Google Ads: GAQL for the daily campaign report, parsing of `googleAds:search` results, micros conversion and INR conversion. Pure.
// The REST (JSON) response uses camelCase field names and int64 values as strings. A row that cannot be read is rejected, never zeroed.
import { count, num } from "../shared/mode";
import { MAX_NAME_LEN } from "./constants";

export interface RawAdsRow {
  campaign?: { id?: string | number; name?: string; status?: string };
  segments?: { date?: string };
  metrics?: { costMicros?: string | number; impressions?: string | number; clicks?: string | number; conversions?: string | number };
}
export interface AdsPage { results: RawAdsRow[]; nextPageToken?: string }

/** GAQL for one window. Dates are validated YYYY-MM-DD by the caller (planWindow output), so they cannot carry query text. */
export function campaignQuery(since: string, until: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new Error("ads: bad window");
  return [
    "SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions",
    "FROM campaign", `WHERE segments.date BETWEEN '${since}' AND '${until}'`, "ORDER BY segments.date",
  ].join(" ");
}

/**
 * Micros (millionths of the account currency, an int64 sent as a string) -> currency units. Exact for any int64 via BigInt on the string
 * form; a number input is accepted for fixtures. Negative or unreadable = null.
 */
export function microsToUnits(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v / 1_000_000 : null;
  if (typeof v !== "string" || !/^\d{1,19}$/.test(v)) return null;
  const m = BigInt(v), whole = m / 1_000_000n, frac = m % 1_000_000n;
  return Number(whole) + Number(frac) / 1_000_000;
}

/** settings.fx_to_inr = { "USD": 83.1 }: the tenant's own conversion rate to INR. Only positive finite numbers count. */
export function fxRatesOf(settings: Record<string, unknown>): Record<string, number> {
  const raw = settings.fx_to_inr, out: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) if (/^[A-Za-z]{3}$/.test(k) && typeof v === "number" && Number.isFinite(v) && v > 0) out[k.toUpperCase()] = v;
  return out;
}

/** Cost micros in the account currency -> INR rupees to paise. INR passes through; another currency needs the tenant's rate. */
export function costInr(micros: unknown, currency: string | undefined, fx: Record<string, number>): number | null {
  const units = microsToUnits(micros);
  if (units === null) return null;
  const cur = (currency ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return null;
  const rate = cur === "INR" ? 1 : fx[cur];
  return rate ? Math.round(units * rate * 100) / 100 : null;
}

export interface AdsDailyRow { campaignId: string; externalCampaignId: string; day: string; spendInr: number; impressions: number; clicks: number; platformLeads: number }
export type AdsReject = "bad_day" | "no_campaign" | "bad_cost" | "currency_unconvertible";
export type NormalisedAds = { ok: true; row: Omit<AdsDailyRow, "campaignId">; name: string } | { ok: false; reason: AdsReject };

/**
 * One result row -> a campaign-day. `conversions` is fractional (data-driven attribution); the column is a whole count, so it is rounded.
 * Reach is not part of the campaign report (it is per-audience in Google Ads) and stays 0.
 */
export function normaliseRow(raw: RawAdsRow, currency: string | undefined, fx: Record<string, number>): NormalisedAds {
  const day = raw.segments?.date ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return { ok: false, reason: "bad_day" };
  const id = raw.campaign?.id === undefined ? "" : String(raw.campaign.id);
  if (!/^\d{1,20}$/.test(id)) return { ok: false, reason: "no_campaign" };
  const micros = raw.metrics?.costMicros ?? 0;
  if (microsToUnits(micros) === null) return { ok: false, reason: "bad_cost" };
  const inr = costInr(micros, currency, fx);
  if (inr === null) return { ok: false, reason: "currency_unconvertible" };
  const conv = num(raw.metrics?.conversions);
  return {
    ok: true, name: (raw.campaign?.name ?? "").trim().slice(0, MAX_NAME_LEN) || `Campaign ${id}`,
    row: { externalCampaignId: id, day, spendInr: inr, impressions: count(raw.metrics?.impressions), clicks: count(raw.metrics?.clicks), platformLeads: conv !== null && conv > 0 ? Math.round(conv) : 0 },
  };
}
