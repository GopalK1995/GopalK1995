// Minimal 5-field cron (minute hour day-of-month month day-of-week) evaluated in an IANA time zone.
// Supports *, lists, ranges, steps and names-free numeric fields; day-of-week 0 or 7 is Sunday. Standard OR rule when both dom and dow are set.

interface Field { any: boolean; set: Set<number> }

function parseField(src: string, min: number, max: number, dow = false): Field {
  if (src === "*") return { any: true, set: new Set() };
  const set = new Set<number>();
  for (const part of src.split(",")) {
    const [range, stepS] = part.split("/");
    const step = stepS === undefined ? 1 : Number(stepS);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad cron step in "${src}"`);
    let lo: number, hi: number;
    if (range === "*") { lo = min; hi = max; }
    else if (range.includes("-")) { const [a, b] = range.split("-").map(Number); lo = a; hi = b; }
    else { lo = Number(range); hi = stepS === undefined ? lo : max; }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > (dow ? 7 : max) || lo > hi) throw new Error(`bad cron field "${src}"`);
    for (let v = lo; v <= hi; v += step) set.add(dow && v === 7 ? 0 : v);
  }
  return { any: false, set };
}

export interface CronSpec { minute: Field; hour: Field; dom: Field; month: Field; dow: Field }

export function parseCron(expr: string): CronSpec {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) throw new Error("cron needs 5 fields");
  return { minute: parseField(p[0], 0, 59), hour: parseField(p[1], 0, 23), dom: parseField(p[2], 1, 31), month: parseField(p[3], 1, 12), dow: parseField(p[4], 0, 6, true) };
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    fmtCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) o[x.type] = x.value;
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday);
  return { minute: +o.minute, hour: +o.hour % 24, dom: +o.day, month: +o.month, dow };
}

const ok = (f: Field, v: number) => f.any || f.set.has(v);

/** First matching minute strictly after `after` (ms epoch), or null within ~2 years. */
export function nextCronRun(expr: string, tz: string, after: number): number | null {
  const s = parseCron(expr);
  let t = Math.floor(after / 60_000) * 60_000 + 60_000;
  const limit = after + 2 * 366 * 86_400_000;
  while (t <= limit) {
    const p = parts(t, tz);
    const dayOk = s.dom.any && s.dow.any ? true : s.dom.any ? ok(s.dow, p.dow) : s.dow.any ? ok(s.dom, p.dom) : ok(s.dom, p.dom) || ok(s.dow, p.dow);
    if (!ok(s.month, p.month) || !dayOk) { t += (24 * 60 - (p.hour * 60 + p.minute)) * 60_000; continue; } // jump to the next local midnight
    if (!ok(s.hour, p.hour)) { t += (60 - p.minute) * 60_000; continue; }
    if (!ok(s.minute, p.minute)) { t += 60_000; continue; }
    return t;
  }
  return null;
}
