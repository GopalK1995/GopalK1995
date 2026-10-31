// Quiet hours, evaluated in Asia/Kolkata (UTC+5:30, no DST) regardless of the server time zone.
export interface QuietHours { start: number; end: number } // minutes since IST midnight; start > end wraps past midnight
const IST_OFFSET_MIN = 330;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function istMinutes(d: Date): number {
  return (((Math.floor(d.getTime() / 60000) + IST_OFFSET_MIN) % 1440) + 1440) % 1440;
}
export function parseHHMM(s: string): number | null {
  const m = HHMM.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const fmtHHMM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** "22:00-07:00" -> {start, end}; anything else (or start == end) -> null (no quiet hours). */
export function parseQuiet(s: string | null | undefined): QuietHours | null {
  if (!s) return null;
  const parts = s.split("-");
  if (parts.length !== 2) return null;
  const start = parseHHMM(parts[0]), end = parseHHMM(parts[1]);
  return start === null || end === null || start === end ? null : { start, end };
}
export const formatQuiet = (q: QuietHours | null) => (q ? `${fmtHHMM(q.start)}-${fmtHHMM(q.end)}` : "");

export function inQuietHours(now: Date, q: QuietHours | null): boolean {
  if (!q) return false;
  const m = istMinutes(now);
  return q.start < q.end ? m >= q.start && m < q.end : m >= q.start || m < q.end;
}
/** First instant at or after `now` when quiet hours are over (now itself when not quiet). */
export function quietEndsAt(now: Date, q: QuietHours | null): Date {
  if (!q || !inQuietHours(now, q)) return now;
  const m = istMinutes(now);
  const wait = (q.end - m + 1440) % 1440;
  const base = new Date(Math.floor(now.getTime() / 60000) * 60000);
  return new Date(base.getTime() + wait * 60000);
}
