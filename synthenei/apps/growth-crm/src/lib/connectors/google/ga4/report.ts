// GA4 Data API runReport response -> rows for ga4_daily. Pure. Follows the published schema: `dimensionHeaders[].name`,
// `metricHeaders[].name`, `rows[].dimensionValues[].value`, `rows[].metricValues[].value` (all strings), `rowCount`, `metadata`.
// Columns are matched by header name, never by position. A row that cannot be read is rejected, not zeroed.
import { count, num } from "../shared/mode";
import { DIMENSIONS, MAX_FIELD_LEN, METRICS } from "./constants";

export interface RunReportResponse {
  dimensionHeaders?: { name?: string }[]; metricHeaders?: { name?: string; type?: string }[];
  rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
  rowCount?: number; metadata?: { dataLossFromOtherRow?: boolean; subjectToThresholding?: boolean; currencyCode?: string; timeZone?: string };
}
export interface RawReportRow { dims: Record<string, string>; metrics: Record<string, string> }
export interface ParsedReport { rows: RawReportRow[]; rowCount: number; otherRow: boolean; thresholded: boolean }

export function parseReport(r: RunReportResponse): ParsedReport {
  const dn = (r.dimensionHeaders ?? []).map((h) => h.name ?? ""), mn = (r.metricHeaders ?? []).map((h) => h.name ?? "");
  const rows: RawReportRow[] = (r.rows ?? []).map((row) => {
    const dims: Record<string, string> = {}, metrics: Record<string, string> = {};
    dn.forEach((n, i) => { if (n) dims[n] = row.dimensionValues?.[i]?.value ?? ""; });
    mn.forEach((n, i) => { if (n) metrics[n] = row.metricValues?.[i]?.value ?? ""; });
    return { dims, metrics };
  });
  return { rows, rowCount: typeof r.rowCount === "number" ? r.rowCount : rows.length, otherRow: r.metadata?.dataLossFromOtherRow === true, thresholded: r.metadata?.subjectToThresholding === true };
}

export interface Ga4DailyRow {
  day: string; channelGroup: string; sourceMedium: string; deviceCategory: string; city: string; landingPage: string; campaign: string;
  sessions: number; engagedSessions: number; totalUsers: number; newUsers: number; avgEngagementSecs: number | null; keyEvents: number;
}
export type Ga4Reject = "bad_day" | "bad_metric";
export type NormalisedGa4 = { ok: true; row: Ga4DailyRow } | { ok: false; reason: Ga4Reject };

/** GA4 spells an unknown value "(not set)": stored as an empty string, except the channel group which is NOT NULL and becomes "Unassigned". */
const clean = (v: string | undefined): string => { const s = (v ?? "").trim(); return s === "(not set)" ? "" : s.slice(0, MAX_FIELD_LEN); };

/** GA4 `date` dimension is YYYYMMDD. */
export function ymdToDay(s: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`, t = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === day ? day : null;
}

export function normaliseRow(raw: RawReportRow): NormalisedGa4 {
  const day = ymdToDay(raw.dims.date ?? "");
  if (!day) return { ok: false, reason: "bad_day" };
  const parsed = METRICS.map((m) => num(raw.metrics[m]));
  if (parsed.some((n) => n === null || n < 0)) return { ok: false, reason: "bad_metric" };
  const [sessions, engaged, users, fresh, duration, keyEvents] = parsed as number[];
  return {
    ok: true,
    row: {
      day, channelGroup: clean(raw.dims.sessionDefaultChannelGroup) || "Unassigned", sourceMedium: clean(raw.dims.sessionSourceMedium), deviceCategory: clean(raw.dims.deviceCategory),
      city: clean(raw.dims.city), landingPage: clean(raw.dims.landingPage), campaign: clean(raw.dims.sessionCampaignName),
      sessions: count(sessions), engagedSessions: count(engaged), totalUsers: count(users), newUsers: count(fresh),
      // engagement seconds per session, to 2 decimals; null when there were no sessions (a division by zero is not a zero).
      avgEngagementSecs: sessions > 0 ? Math.round((duration / sessions) * 100) / 100 : null, keyEvents: count(keyEvents),
    },
  };
}

const keyOf = (r: Ga4DailyRow, withCampaign: boolean) => [r.day, r.channelGroup, r.sourceMedium, r.deviceCategory, r.city, r.landingPage, withCampaign ? r.campaign : ""].join("\u0001");

/**
 * Merges rows that share a key. Needed because one page of the report can repeat a key (two campaigns on the same row key when the table has
 * no campaign column, or a window re-read across pages). Counts are summed; the average engagement is re-weighted by sessions. Users are
 * summed too, which over-counts people who appear in more than one merged row: sessions and key events stay exact.
 */
export function mergeRows(rows: Ga4DailyRow[], withCampaign: boolean): Ga4DailyRow[] {
  const out = new Map<string, Ga4DailyRow>();
  for (const r of rows) {
    const k = keyOf(r, withCampaign), cur = out.get(k);
    if (!cur) { out.set(k, { ...r, campaign: withCampaign ? r.campaign : "" }); continue; }
    const total = cur.sessions + r.sessions;
    const weighted = total > 0 ? ((cur.avgEngagementSecs ?? 0) * cur.sessions + (r.avgEngagementSecs ?? 0) * r.sessions) / total : null;
    out.set(k, {
      ...cur, sessions: total, engagedSessions: cur.engagedSessions + r.engagedSessions, totalUsers: cur.totalUsers + r.totalUsers, newUsers: cur.newUsers + r.newUsers,
      keyEvents: cur.keyEvents + r.keyEvents, avgEngagementSecs: weighted === null ? null : Math.round(weighted * 100) / 100,
    });
  }
  return [...out.values()];
}

/** The runReport request body for a window page. Dimension and metric names are the published API names. */
export function reportRequest(since: string, until: string, offset: number, limit: number) {
  return {
    dateRanges: [{ startDate: since, endDate: until }], dimensions: DIMENSIONS.map((name) => ({ name })), metrics: METRICS.map((name) => ({ name })),
    limit: String(limit), offset: String(offset), keepEmptyRows: false, orderBys: [{ dimension: { dimensionName: "date" } }],
  };
}
