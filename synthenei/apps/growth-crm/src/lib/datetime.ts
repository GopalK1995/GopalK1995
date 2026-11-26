// The one date/time module for anything a person reads or types. Everything is Asia/Kolkata (IST, UTC+05:30, no daylight saving),
// regardless of the server's or the browser's zone, and times that matter legally say "IST" out loud (breach and privacy pages, audit, tasks).
// Pure and client-safe (no Next.js, no React). Instants are always stored and passed around as UTC ISO strings.
export const IST_ZONE = "Asia/Kolkata";
export const IST_LABEL = "IST";
/** IST is a fixed +05:30 offset all year: India has no daylight saving, so adding the offset by hand is exact. */
export const IST_OFFSET_MS = 330 * 60_000;
const LOCALE = "en-IN";

type Instant = string | number | Date;
const toDate = (v: Instant): Date => (v instanceof Date ? v : new Date(v));
const valid = (d: Date) => !Number.isNaN(d.getTime());

const dateFmt = (o: Intl.DateTimeFormatOptions) => (v: Instant): string => {
  const d = toDate(v);
  return valid(d) ? new Intl.DateTimeFormat(LOCALE, { ...o, timeZone: IST_ZONE }).format(d) : "";
};

/** 26 Nov 2026 */
export const fmtIstDate = dateFmt({ day: "numeric", month: "short", year: "numeric" });
/** 26 November 2026 */
export const fmtIstDateLong = dateFmt({ day: "numeric", month: "long", year: "numeric" });
/** Nov 2026 */
export const fmtIstMonth = dateFmt({ month: "short", year: "numeric" });
/** 26 Nov 2026, 11:30 pm (no zone word; use fmtIstDateTimeZ where the zone matters) */
export const fmtIstDateTime = (v: Instant): string => {
  const d = toDate(v);
  if (!valid(d)) return "";
  const parts = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST_ZONE }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod").toLowerCase()}`;
};
/** 26 Nov 2026, 11:30 pm IST: the form for deadlines and records someone may act on. */
export const fmtIstDateTimeZ = (v: Instant): string => {
  const s = fmtIstDateTime(v);
  return s ? `${s} ${IST_LABEL}` : "";
};

const pad = (n: number) => String(n).padStart(2, "0");

/** The IST calendar parts of an instant. */
export function istParts(v: Instant): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const d = toDate(v);
  if (!valid(d)) return null;
  const s = new Date(d.getTime() + IST_OFFSET_MS);
  return { y: s.getUTCFullYear(), mo: s.getUTCMonth() + 1, d: s.getUTCDate(), h: s.getUTCHours(), mi: s.getUTCMinutes() };
}

/** Value for <input type="datetime-local"> showing the instant on the IST wall clock: "2026-11-26T23:30". "" when invalid. */
export function toIstInputValue(v: Instant): string {
  const p = istParts(v);
  return p ? `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}` : "";
}

const INPUT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
/**
 * What the person typed into a datetime-local input IS an IST wall-clock time (the form says so). Returns the UTC ISO instant,
 * or null for anything that is not a real calendar time (empty, 31 Feb, 25:00).
 */
export function istInputToIso(value: string): string | null {
  const m = INPUT_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const utc = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(utc);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || back.getUTCHours() !== h || back.getUTCMinutes() !== mi) return null;
  return new Date(utc - IST_OFFSET_MS).toISOString();
}

/** Instant plus hours, as a UTC ISO string. Elapsed time, so it is exact in any zone (neither IST nor UTC has daylight saving). */
export function addHoursIso(iso: string, hours: number): string {
  return new Date(toDate(iso).getTime() + hours * 3_600_000).toISOString();
}

/** IST calendar day of an instant, "2026-11-26". */
export function istDayKey(v: Instant): string {
  const p = istParts(v);
  return p ? `${p.y}-${pad(p.mo)}-${pad(p.d)}` : "";
}
