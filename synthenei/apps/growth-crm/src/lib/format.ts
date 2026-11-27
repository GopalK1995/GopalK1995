// Formatting helpers. Indian numbering (lakh / crore) in English and Tamil. IST everywhere.
// formatters(locale) is the one implementation; the legacy helpers below are thin wrappers that default to English
// and take an optional trailing locale, so a screen can pass the active next-intl locale (see useFormatters / getFormatters).
const IST = "Asia/Kolkata";

/** The one marker for a missing / non-computable reading. Never render NaN, Infinity or a fake 0. */
export const NO_DATA = "No data";
type Maybe = number | null | undefined;
/** True for a finite number (not null, undefined, NaN or +-Infinity). */
export const isNum = (n: Maybe): n is number => typeof n === "number" && Number.isFinite(n);

export type FormatLocale = "en" | "ta";
export const intlTagFor = (locale: FormatLocale = "en") => (locale === "ta" ? "ta-IN" : "en-IN");

/**
 * Compact unit rule (money and counts): under 1,000 the whole number; then K (thousand), L (lakh, 1,00,000) and Cr (crore, 1,00,00,000).
 * The value is rounded to ONE decimal at its unit FIRST, and if that rounding reaches 100 the next unit is used,
 * so 99,999.6 is "1L" (never "100K") and 99,99,999 is "1Cr" (never "100L"). A trailing ".0" is dropped. Cr has no upper unit and keeps Indian grouping.
 * Tamil shows the words ஆயிரம் / லட்சம் / கோடி after a space ("4.2 லட்சம்").
 */
const UNITS = { en: { K: "K", L: "L", Cr: "Cr" }, ta: { K: " ஆயிரம்", L: " லட்சம்", Cr: " கோடி" } } as const;
const round1 = (x: number) => Math.round(x * 10) / 10;
function compactText(abs: number, locale: FormatLocale, whole: Intl.NumberFormat, one: Intl.NumberFormat): string {
  const r0 = Math.round(abs);
  if (r0 < 1000) return whole.format(r0);
  const u = UNITS[locale];
  const k = round1(abs / 1e3);
  if (k < 100) return `${one.format(k)}${u.K}`;
  const l = round1(abs / 1e5);
  if (l < 100) return `${one.format(l)}${u.L}`;
  return `${one.format(round1(abs / 1e7))}${u.Cr}`;
}

type When = string | number | Date;
const dateOk = (v: When) => !Number.isNaN(new Date(v).getTime());

export function formatters(locale: FormatLocale = "en") {
  const tag = intlTagFor(locale);
  const n0 = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
  const n1 = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
  const fixedCache = new Map<number, Intl.NumberFormat>();
  const fixedF = (d: number) => { let f = fixedCache.get(d); if (!f) { f = new Intl.NumberFormat(tag, { minimumFractionDigits: d, maximumFractionDigits: d }); fixedCache.set(d, f); } return f; };
  const pctCache = new Map<number, Intl.NumberFormat>();
  const pctF = (d: number) => { let f = pctCache.get(d); if (!f) { f = new Intl.NumberFormat(tag, { style: "percent", minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: "negative" }); pctCache.set(d, f); } return f; };
  const dt = (o: Intl.DateTimeFormatOptions) => {
    const f = new Intl.DateTimeFormat(tag, { ...o, timeZone: IST });
    return (v: When) => (dateOk(v) ? f.format(new Date(v)) : NO_DATA);
  };
  const dateShort = dt({ day: "numeric", month: "short" });
  const date = dt({ day: "numeric", month: "short", year: "numeric" });
  const timeRaw = dt({ hour: "numeric", minute: "2-digit", hour12: true });
  const time = (v: When) => { const t = timeRaw(v); return locale === "en" ? t.toLowerCase() : t; };
  const rel = new Intl.RelativeTimeFormat(tag, { numeric: "always", style: "short" });
  /** Sign goes BEFORE the symbol (-₹12,34,567). A value that rounds to nothing carries no sign. */
  const signed = (n: number, body: (abs: number) => string, symbol = "", zero = Math.round(Math.abs(n)) === 0) =>
    `${n < 0 && !zero ? "-" : ""}${symbol}${body(Math.abs(n))}`;
  return {
    tag,
    locale,
    /** Whole number with Indian grouping: 1234567 -> 12,34,567. */
    number: (n: Maybe) => (isNum(n) ? signed(n, (a) => n0.format(Math.round(a))) : NO_DATA),
    /** Fixed decimals with Indian grouping. */
    numberFixed: (n: Maybe, digits = 1) => (isNum(n) ? signed(n, (a) => fixedF(digits).format(a), "", Number(Math.abs(n).toFixed(digits)) === 0) : NO_DATA),
    numberCompact: (n: Maybe) => (isNum(n) ? signed(n, (a) => compactText(a, locale, n0, n1)) : NO_DATA),
    /** ₹12,34,567 (whole rupees); negative is -₹12,34,567. */
    inr: (n: Maybe) => (isNum(n) ? signed(n, (a) => n0.format(Math.round(a)), "₹") : NO_DATA),
    /** ₹4.2L / ₹1.3Cr / ₹8.4K (Tamil: ₹4.2 லட்சம்). See the compact unit rule above. */
    inrCompact: (n: Maybe) => (isNum(n) ? signed(n, (a) => compactText(a, locale, n0, n1), "₹") : NO_DATA),
    /** x is a fraction: 0.123 -> 12.3% (digits decimals). */
    percent: (x: Maybe, digits = 1) => (isNum(x) ? pctF(digits).format(x) : NO_DATA),
    date, dateShort, time,
    dateTime: (v: When) => (dateOk(v) ? `${dateShort(v)}, ${time(v)}` : NO_DATA),
    weekday: dt({ weekday: "short" }),
    /** "November 2026": IST month, locale month name. */
    monthYear: dt({ month: "long", year: "numeric" }),
    monthLong: dt({ month: "long" }),
    relTime(iso: string, nowIso: string) {
      const diff = new Date(nowIso).getTime() - new Date(iso).getTime();
      if (!Number.isFinite(diff)) return NO_DATA;
      const fut = diff < 0, m = Math.abs(diff) / 60e3;
      if (locale === "en") {
        const s = m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
        return fut ? `in ${s}` : `${s} ago`;
      }
      const [v, unit] = m < 60 ? ([Math.max(1, Math.round(m)), "minute"] as const) : m < 1440 ? ([Math.round(m / 60), "hour"] as const) : ([Math.round(m / 1440), "day"] as const);
      return rel.format(fut ? v : -v, unit);
    },
    /** Name sorting that does not depend on the server's or browser's default locale. */
    collator: new Intl.Collator(tag, { sensitivity: "base", numeric: true }),
  };
}
export type Formatters = ReturnType<typeof formatters>;
const cache: Partial<Record<FormatLocale, Formatters>> = {};
/** Shared, memoised instance per locale. */
export const fmtFor = (locale: FormatLocale = "en"): Formatters => (cache[locale] ??= formatters(locale));

/** ₹12,34,567. Sign first for negatives. */
export const inr = (n: Maybe, locale: FormatLocale = "en") => fmtFor(locale).inr(n);
/** Compact INR: ₹4.2L, ₹1.3Cr, ₹8.4K. Rounds before choosing the unit (99,999.6 -> ₹1L). */
export const inrCompact = (n: Maybe, locale: FormatLocale = "en") => fmtFor(locale).inrCompact(n);
export const num = (n: Maybe, locale: FormatLocale = "en") => fmtFor(locale).number(n);
export const numCompact = (n: Maybe, locale: FormatLocale = "en") => fmtFor(locale).numberCompact(n);
/** x is a fraction (0.123 = 12.3%). */
export const pct = (x: Maybe, digits = 1, locale: FormatLocale = "en") => fmtFor(locale).percent(x, digits);
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

export const fmtDate = (iso: string, locale: FormatLocale = "en") => fmtFor(locale).dateShort(iso);
export const fmtDateY = (iso: string, locale: FormatLocale = "en") => fmtFor(locale).date(iso);
export const fmtTime = (iso: string, locale: FormatLocale = "en") => fmtFor(locale).time(iso);
export const fmtDateTime = (iso: string, locale: FormatLocale = "en") => fmtFor(locale).dateTime(iso);
export const fmtWeekday = (iso: string, locale: FormatLocale = "en") => fmtFor(locale).weekday(iso);
/** "November 2026" for an IST instant (not UTC). */
export const fmtMonthYear = (v: string | number | Date, locale: FormatLocale = "en") => fmtFor(locale).monthYear(v);
export const dayKey = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

export const relTime = (iso: string, nowIso: string, locale: FormatLocale = "en") => fmtFor(locale).relTime(iso, nowIso);
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
