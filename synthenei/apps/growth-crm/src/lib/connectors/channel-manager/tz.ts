// Time-zone helpers on Intl only (no library): wall time in an IANA zone <-> UTC instants, and "which calendar date is it there".
// Pure. An unknown zone name is reported, never silently treated as something else by the caller (see `validZone`).
import type { DateOnly } from "./types";

const fmt = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmt.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }); fmt.set(tz, f); }
  return f;
}

export function validZone(tz: string): boolean {
  if (tz === "UTC") return true;
  try { formatter(tz); return true; } catch { return false; }
}

interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }
function wallAt(ms: number, tz: string): Wall {
  const o: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, mo: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, mi: o.minute, s: o.second };
}
const asUtcMs = (w: Wall): number => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);

/** The UTC instant at which the wall clock in `tz` reads the given fields. In a DST gap the instant just after the gap is used; in an overlap the earlier one. */
export function wallToUtc(w: Wall, tz: string): number {
  if (tz === "UTC") return asUtcMs(w);
  const guess = asUtcMs(w);
  let off = asUtcMs(wallAt(guess, tz)) - guess;
  let t = guess - off;
  const off2 = asUtcMs(wallAt(t, tz)) - t;
  if (off2 !== off) { off = off2; t = guess - off; }
  return t;
}

/** The calendar date (YYYY-MM-DD) in `tz` at the instant `ms`. */
export function dateInZone(ms: number, tz: string): DateOnly {
  const w = wallAt(ms, tz);
  return `${String(w.y).padStart(4, "0")}-${String(w.mo).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}
