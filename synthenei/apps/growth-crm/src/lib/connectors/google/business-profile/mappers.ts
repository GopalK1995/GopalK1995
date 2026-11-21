// Pure mappers for Business Profile payloads (Google's published REST shapes; values in the tests are synthetic). A value that cannot
// be read is null, never 0; a review without an id or a usable star rating is rejected, not invented.
import { isDay } from "../shared/dates";
import { MAX_NAME_LEN, METRIC } from "./constants";

export interface RawReview {
  name?: string; reviewId?: string; starRating?: string; comment?: string; createTime?: string; updateTime?: string;
  reviewer?: { displayName?: string; isAnonymous?: boolean };
  reviewReply?: { comment?: string; updateTime?: string };
}
export interface RawDate { year?: number; month?: number; day?: number }
export interface RawSeries { dailyMetric?: string; timeSeries?: { datedValues?: { date?: RawDate; value?: string | number }[] } }

const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
export const starsOf = (v: unknown): number | null => (typeof v === "string" ? STARS[v.toUpperCase()] ?? null : null);

const iso = (v: unknown): string | null => { if (typeof v !== "string") return null; const t = Date.parse(v); return Number.isNaN(t) ? null : new Date(t).toISOString(); };

export interface ReviewRow { externalId: string; rating: number; text: string | null; author: string | null; reviewedAt: string | null; externalReply: string | null; externalReplyAt: string | null }
export type ReviewResult = { ok: true; row: ReviewRow } | { ok: false; reason: "missing_id" | "bad_rating" };

export function normaliseReview(r: RawReview): ReviewResult {
  const id = (r.reviewId ?? (r.name ? r.name.split("/").pop() : "") ?? "").trim();
  if (!id) return { ok: false, reason: "missing_id" };
  const rating = starsOf(r.starRating);
  if (rating === null) return { ok: false, reason: "bad_rating" };   // STAR_RATING_UNSPECIFIED
  const anon = r.reviewer?.isAnonymous === true, name = (r.reviewer?.displayName ?? "").trim();
  const reply = (r.reviewReply?.comment ?? "").trim();
  return { ok: true, row: {
    externalId: id, rating, text: (r.comment ?? "").trim() || null,
    author: anon || !name ? null : name.slice(0, MAX_NAME_LEN),
    reviewedAt: iso(r.createTime), externalReply: reply || null, externalReplyAt: reply ? iso(r.reviewReply?.updateTime) : null,
  } };
}

export interface MetricsRow {
  day: string; impressionsSearch: number | null; impressionsMaps: number | null; callClicks: number | null; websiteClicks: number | null;
  directionRequests: number | null; conversations: number | null; bookings: number | null; foodOrders: number | null;
}

const dayOf = (d?: RawDate): string | null => {
  if (!d || !Number.isInteger(d.year) || !Number.isInteger(d.month) || !Number.isInteger(d.day)) return null;
  const s = `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  return isDay(s) ? s : null;
};
const intOf = (v: unknown): number | null => { const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,15}$/.test(v) ? Number(v) : NaN; return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; };
/** A dated entry with no `value` is how Google reports zero; a day missing from the series entirely stays unknown (null). */
const valueOf = (e: { value?: string | number }): number | null => (e.value === undefined || e.value === null ? 0 : intOf(e.value));
const add = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

/** Folds the per-metric series into one row per day. Only days in [since, until] are kept. */
export function foldSeries(series: RawSeries[], since: string, until: string): { rows: MetricsRow[]; rejected: number } {
  const byDay = new Map<string, Map<string, number | null>>();
  let rejected = 0;
  for (const s of series) {
    const metric = s.dailyMetric ?? "";
    for (const e of s.timeSeries?.datedValues ?? []) {
      const day = dayOf(e.date);
      if (!day) { rejected++; continue; }
      if (day < since || day > until) continue;
      const v = valueOf(e);
      if (v === null) { rejected++; continue; }
      let m = byDay.get(day);
      if (!m) { m = new Map(); byDay.set(day, m); }
      m.set(metric, v);
    }
  }
  const rows = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, m]): MetricsRow => {
    const g = (k: string) => (m.has(k) ? m.get(k)! : null);
    return {
      day,
      impressionsSearch: add(g(METRIC.searchDesktop), g(METRIC.searchMobile)), impressionsMaps: add(g(METRIC.mapsDesktop), g(METRIC.mapsMobile)),
      callClicks: g(METRIC.calls), websiteClicks: g(METRIC.website), directionRequests: g(METRIC.directions),
      conversations: g(METRIC.conversations), bookings: g(METRIC.bookings), foodOrders: g(METRIC.foodOrders),
    };
  });
  return { rows, rejected };
}

/** `dailyRange.*` query parameters for fetchMultiDailyMetricsTimeSeries. Dates are validated, so no query text can slip in. */
export function rangeParams(since: string, until: string): [string, string][] {
  if (!isDay(since) || !isDay(until)) throw new Error("gbp: bad window");
  const p = (pre: string, d: string): [string, string][] => { const [y, m, dd] = d.split("-"); return [[`${pre}.year`, String(Number(y))], [`${pre}.month`, String(Number(m))], [`${pre}.day`, String(Number(dd))]]; };
  return [...p("dailyRange.startDate", since), ...p("dailyRange.endDate", until)];
}
