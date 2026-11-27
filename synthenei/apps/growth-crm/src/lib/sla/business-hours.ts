// First-response SLA clock inside business hours (AUD-025, BE-017).
// Pure and client-safe. Instants are epoch ms, Date or ISO strings. Working windows come from the workspace config:
// days (0 = Sunday .. 6 = Saturday), start/end as HH:MM local time, an IANA timezone (default Asia/Kolkata, which has no daylight
// saving) and an optional holiday list (YYYY-MM-DD local dates). The SQL twin is public.business_due_at() in migration 0029.

export interface SlaHours {
  days: number[];
  start: string;
  end: string;
  timezone?: string;
  holidays?: string[];
}

export const DEFAULT_SLA_TZ = "Asia/Kolkata";
/** The default the product has always documented: 10:00 to 19:00 IST, Monday to Saturday. */
export const DEFAULT_SLA_HOURS: SlaHours = { days: [1, 2, 3, 4, 5, 6], start: "10:00", end: "19:00", timezone: DEFAULT_SLA_TZ, holidays: [] };

const MIN = 60_000;
const MAX_SCAN_DAYS = 400;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMs = (v: string | number | Date): number => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : new Date(v).getTime());

/** Minutes from midnight for "HH:MM", or null when malformed. */
export function parseHm(s: string): number | null {
  const m = HHMM.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** True when the config yields at least one non-empty daily window (start before end, a valid day, valid zone). */
export function hasBusinessWindow(h: SlaHours): boolean {
  const s = parseHm(h.start), e = parseHm(h.end);
  if (s === null || e === null || s >= e) return false;
  if (!h.days.some((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: h.timezone ?? DEFAULT_SLA_TZ }); } catch { return false; }
  return true;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }); fmtCache.set(tz, f); }
  return f;
}

/** Offset (zone local minus UTC) in ms at an instant. */
function offsetMs(ms: number, tz: string): number {
  const p = fmt(tz).formatToParts(new Date(ms));
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Epoch ms of local wall time (y, m 0-based, d) at minute-of-day `mod` in the zone. */
function localToUtc(y: number, m: number, d: number, mod: number, tz: string): number {
  const guess = Date.UTC(y, m, d, 0, mod, 0);
  const first = guess - offsetMs(guess, tz);
  return guess - offsetMs(first, tz);
}

interface Local { y: number; m: number; d: number; dow: number; key: string }
const mkLocal = (t: Date): Local => ({ y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), dow: t.getUTCDay(), key: `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}` });
const localDay = (ms: number, tz: string): Local => mkLocal(new Date(ms + offsetMs(ms, tz)));
const nextLocalDay = (l: Local): Local => mkLocal(new Date(Date.UTC(l.y, l.m, l.d + 1)));

/** The [open, close) windows (epoch ms) from the local day containing `fromMs` onward, the first clipped to start at `fromMs`. */
function* windowsFrom(fromMs: number, h: SlaHours): Generator<[number, number]> {
  const tz = h.timezone ?? DEFAULT_SLA_TZ;
  const s = parseHm(h.start)!, e = parseHm(h.end)!;
  const days = new Set(h.days), hol = new Set(h.holidays ?? []);
  let day = localDay(fromMs, tz);
  for (let i = 0; i < MAX_SCAN_DAYS; i++, day = nextLocalDay(day)) {
    if (!days.has(day.dow) || hol.has(day.key)) continue;
    const open = localToUtc(day.y, day.m, day.d, s, tz), close = localToUtc(day.y, day.m, day.d, e, tz);
    if (close <= fromMs) continue;
    yield [Math.max(open, fromMs), close];
  }
}

/** Earliest instant at or after `from` that is inside a business window; null when the config has no usable window. */
export function nextBusinessInstant(from: string | number | Date, h: SlaHours): number | null {
  const f = toMs(from);
  if (!Number.isFinite(f) || !hasBusinessWindow(h)) return null;
  for (const [a] of windowsFrom(f, h)) return a;
  return null;
}

/** Instant when `mins` business minutes have elapsed after `from`. A lead created at 22:00 starts its clock at the next opening.
 *  Null when no business window exists (callers then fall back to wall-clock and say so). */
export function addBusinessMinutes(from: string | number | Date, mins: number, h: SlaHours): number | null {
  const f = toMs(from);
  if (!Number.isFinite(f) || !Number.isFinite(mins) || mins < 0 || !hasBusinessWindow(h)) return null;
  let left = Math.round(mins) * MIN;
  for (const [a, b] of windowsFrom(f, h)) {
    const room = b - a;
    if (left <= room) return a + left;
    left -= room;
  }
  return null;
}

/** Business minutes (whole, floored) between two instants. 0 when b <= a or no window exists. */
export function businessMinutesBetween(a: string | number | Date, b: string | number | Date, h: SlaHours): number {
  const from = toMs(a), to = toMs(b);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || !hasBusinessWindow(h)) return 0;
  let total = 0;
  for (const [x, y] of windowsFrom(from, h)) {
    if (x >= to) break;
    total += Math.min(y, to) - x;
  }
  return Math.floor(total / MIN);
}

/** SlaHours from the tenant config's businessHours plus the workspace timezone and holidays. */
export function slaHoursFrom(bh: { days: number[]; start: string; end: string } | null | undefined, extra?: { timezone?: string | null; holidays?: string[] | null }): SlaHours {
  const base = bh ?? DEFAULT_SLA_HOURS;
  return { days: [...base.days], start: base.start, end: base.end, timezone: extra?.timezone || DEFAULT_SLA_TZ, holidays: extra?.holidays ?? [] };
}

/** Elapsed first-response minutes for a lead inside business hours: answered leads run created to first response, unanswered run created to now. */
export function leadResponseBusinessMins(createdAt: string, firstResponseMins: number | null, nowMs: number, h: SlaHours): number {
  const c = toMs(createdAt);
  const end = firstResponseMins === null ? nowMs : c + firstResponseMins * MIN;
  return businessMinutesBetween(c, end, h);
}

/** Honest one-line description of the clock for the UI, e.g. "2 business hours (Mon to Sat, 10:00 to 19:00 IST)". */
export function describeSlaClock(slaMins: number, h: SlaHours): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const ds = [...new Set(h.days)].sort((x, y) => x - y);
  const contiguous = ds.length > 1 && ds.every((d, i) => i === 0 || d === ds[i - 1] + 1);
  const dayTxt = ds.length === 7 ? "every day" : contiguous ? `${names[ds[0]]} to ${names[ds[ds.length - 1]]}` : ds.map((d) => names[d]).join(", ");
  const dur = slaMins % 60 === 0 ? `${slaMins / 60} business ${slaMins / 60 === 1 ? "hour" : "hours"}` : `${slaMins} business minutes`;
  const tz = (h.timezone ?? DEFAULT_SLA_TZ) === DEFAULT_SLA_TZ ? "IST" : (h.timezone ?? DEFAULT_SLA_TZ);
  return `${dur} (${dayTxt}, ${h.start} to ${h.end} ${tz})`;
}
