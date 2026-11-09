// Day arithmetic in IST and the incremental window planner shared by the GA4 and Google Ads daily syncs. Pure.
const IST_MS = 330 * 60_000, DAY_MS = 86400e3;

export const istDay = (d: Date): string => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
export const istMinutes = (d: Date): number => { const t = new Date(d.getTime() + IST_MS); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
export const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(Date.parse(`${s}T00:00:00Z`)).toISOString().slice(0, 10) === s;

export interface WindowPolicy {
  /** The sync runs once the IST clock has reached this many minutes past midnight (05:30 = 330). */
  afterMinutesIst: number;
  /** Trailing days re-read on every run (the vendor restates recent days). */
  lookbackDays: number;
  /** Days loaded on the very first run. */
  backfillDays: number;
}
export interface DayWindow { since: string; until: string }

/**
 * Window to load: through yesterday (IST) once the IST clock has passed the sync time, else through the day before (the newest day is
 * not final yet). First run backfills `backfillDays`; later runs re-read the trailing `lookbackDays` ending at the new end. Null = current.
 */
export function planWindow(now: Date, through: string | undefined, p: WindowPolicy): DayWindow | null {
  const today = istDay(now), until = addDays(today, istMinutes(now) >= p.afterMinutesIst ? -1 : -2);
  if (through && through >= until) return null;
  const since = through ? addDays(through, -(p.lookbackDays - 1)) : addDays(until, -(p.backfillDays - 1));
  return since <= until ? { since, until } : null;
}

/** Cursor shared by both daily streams: the last day fully loaded, plus the window and page position of a run in flight. */
export type PagedWindow = DayWindow & { page?: string | number };
export interface DailyCursor { through?: string; win?: PagedWindow }
export function asDailyCursor(c: unknown): DailyCursor {
  const o = c && typeof c === "object" ? (c as DailyCursor) : {};
  const w = o.win;
  const win = w && isDay(w.since) && isDay(w.until) ? { since: w.since, until: w.until, ...(typeof w.page === "string" || typeof w.page === "number" ? { page: w.page } : {}) } : undefined;
  return { through: isDay(o.through) ? o.through : undefined, win };
}
