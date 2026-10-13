// Seeded PRNG + time helpers. Everything in the mock dataset is deterministic so server renders
// and screenshots are stable.

/** Fixed "now": Tuesday 13 Oct 2026, 10:30 IST. */
export const NOW_ISO = "2026-10-13T05:00:00.000Z";
export const NOW_MS = new Date(NOW_ISO).getTime();
export const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;
const IST_OFFSET = 5.5 * HOUR;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed: number) {
  const r = mulberry32(seed);
  const api = {
    next: r,
    int: (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1)),
    float: (lo: number, hi: number) => lo + r() * (hi - lo),
    chance: (p: number) => r() < p,
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)],
    weighted: <T,>(xs: readonly (readonly [T, number])[]): T => {
      const total = xs.reduce((a, [, w]) => a + w, 0);
      let x = r() * total;
      for (const [v, w] of xs) if ((x -= w) <= 0) return v;
      return xs[xs.length - 1][0];
    },
    sample: <T,>(xs: readonly T[], n: number): T[] => {
      const c = [...xs];
      for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; }
      return c.slice(0, n);
    },
  };
  return api;
}
export type Rng = ReturnType<typeof makeRng>;

/** ISO timestamp for an IST wall-clock time `dayOffset` days from today (negative = past). */
export function istAt(dayOffset: number, hour: number, minute = 0) {
  const todayIst = new Date(NOW_MS + IST_OFFSET);
  const ms = Date.UTC(todayIst.getUTCFullYear(), todayIst.getUTCMonth(), todayIst.getUTCDate() + dayOffset, hour, minute) - IST_OFFSET;
  return new Date(ms).toISOString();
}
export const iso = (ms: number) => new Date(ms).toISOString();
/** YYYY-MM-DD in IST for a day offset. */
export const istDate = (dayOffset: number) => istAt(dayOffset, 12).slice(0, 10);
