// Formatting helpers. Indian numbering (lakh / crore) via Intl 'en-IN'. IST everywhere.
const IST = "Asia/Kolkata";
const nf = new Intl.NumberFormat("en-IN");
const nf1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

/** The one marker for a missing / non-computable reading. Never render NaN, Infinity or a fake 0. */
export const NO_DATA = "No data";
type Maybe = number | null | undefined;
/** True for a finite number (not null, undefined, NaN or +-Infinity). */
export const isNum = (n: Maybe): n is number => typeof n === "number" && Number.isFinite(n);

/** ₹12,34,567 */
export const inr = (n: Maybe) => (isNum(n) ? `₹${nf.format(Math.round(n))}` : NO_DATA);
/** Compact INR: ₹4.2L, ₹1.3Cr, ₹8.4K */
export function inrCompact(n: Maybe) {
  if (!isNum(n)) return NO_DATA;
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${nf1.format(n / 1e7)}Cr`;
  if (a >= 1e5) return `₹${nf1.format(n / 1e5)}L`;
  if (a >= 1e3) return `₹${nf1.format(n / 1e3)}K`;
  return `₹${nf.format(Math.round(n))}`;
}
export const num = (n: Maybe) => (isNum(n) ? nf.format(Math.round(n)) : NO_DATA);
export function numCompact(n: Maybe) {
  if (!isNum(n)) return NO_DATA;
  const a = Math.abs(n);
  if (a >= 1e5) return `${nf1.format(n / 1e5)}L`;
  if (a >= 1e3) return `${nf1.format(n / 1e3)}K`;
  return nf.format(Math.round(n));
}
export const pct = (x: Maybe, digits = 1) => (isNum(x) ? `${(x * 100).toFixed(digits)}%` : NO_DATA);
/** a / b, or NaN when either side is missing or b is not above 0 (callers test with isNum, formatters print No data). */
export const ratio = (a: Maybe, b: Maybe) => (isNum(a) && isNum(b) && b > 0 ? a / b : NaN);

/**
 * Relative change cur vs prev as a fraction (0.12 = +12%), or NaN when there is nothing honest to say:
 * either side missing/non-finite, prior value not above `minBase` (zero or tiny baseline), or the current value is exactly 0
 * (a drop to nothing on a partial or empty window reads as "100% down", which is arithmetic, not a trend).
 */
export function deltaOf(cur: Maybe, prev: Maybe, minBase = 0): number {
  if (!isNum(cur) || !isNum(prev) || prev <= minBase || cur === 0) return NaN;
  return cur / prev - 1;
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
export const fmtDateY = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST }).toLowerCase();
export const fmtDateTime = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
export const fmtWeekday = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { weekday: "short", timeZone: IST });
export const dayKey = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

export function relTime(iso: string, nowIso: string) {
  const diff = new Date(nowIso).getTime() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return NO_DATA;
  const fut = diff < 0, m = Math.abs(diff) / 60e3;
  const s = m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  return fut ? `in ${s}` : `${s} ago`;
}
export const minsToHuman = (m: Maybe) => (!isNum(m) ? NO_DATA : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`);
/** Seconds -> "3m 20s" / "45s". Missing or negative -> No data. */
export function secsToHuman(secs: Maybe) {
  if (!isNum(secs) || secs < 0) return NO_DATA;
  const t = Math.round(secs), m = Math.floor(t / 60), s = t % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
export function median(xsIn: Maybe[]) {
  const xs = xsIn.filter(isNum);
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Locale-aware variants (en-IN / ta-IN). The legacy helpers above stay en-IN for existing screens.
export type FormatLocale = "en" | "ta";
export function formatters(locale: FormatLocale = "en") {
  const tag = locale === "ta" ? "ta-IN" : "en-IN";
  const n0 = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const inrF = new Intl.NumberFormat(tag, { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  const dOpts = { timeZone: IST } as const;
  return {
    tag,
    number: (n: Maybe) => (isNum(n) ? n0.format(n) : NO_DATA),
    /** Indian grouping: 1234567 -> 12,34,567 (currency symbol per locale). */
    inr: (n: Maybe) => (isNum(n) ? inrF.format(Math.round(n)) : NO_DATA),
    date: (iso: string) => new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", year: "numeric", ...dOpts }).format(new Date(iso)),
    time: (iso: string) => new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit", hour12: true, ...dOpts }).format(new Date(iso)),
    dateTime: (iso: string) => new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, ...dOpts }).format(new Date(iso)),
  };
}
