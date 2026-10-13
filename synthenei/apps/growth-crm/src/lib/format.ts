// Formatting helpers. Indian numbering (lakh / crore) via Intl 'en-IN'. IST everywhere.
const IST = "Asia/Kolkata";
const nf = new Intl.NumberFormat("en-IN");
const nf1 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });

/** ₹12,34,567 */
export const inr = (n: number) => `₹${nf.format(Math.round(n))}`;
/** Compact INR: ₹4.2L, ₹1.3Cr, ₹8.4K */
export function inrCompact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${nf1.format(n / 1e7)}Cr`;
  if (a >= 1e5) return `₹${nf1.format(n / 1e5)}L`;
  if (a >= 1e3) return `₹${nf1.format(n / 1e3)}K`;
  return `₹${nf.format(Math.round(n))}`;
}
export const num = (n: number) => nf.format(Math.round(n));
export function numCompact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e5) return `${nf1.format(n / 1e5)}L`;
  if (a >= 1e3) return `${nf1.format(n / 1e3)}K`;
  return nf.format(Math.round(n));
}
export const pct = (x: number, digits = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : "–");
export const ratio = (a: number, b: number) => (b > 0 ? a / b : NaN);

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: IST });
export const fmtDateY = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST }).toLowerCase();
export const fmtDateTime = (iso: string) => `${fmtDate(iso)}, ${fmtTime(iso)}`;
export const fmtWeekday = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { weekday: "short", timeZone: IST });
export const dayKey = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

export function relTime(iso: string, nowIso: string) {
  const diff = new Date(nowIso).getTime() - new Date(iso).getTime();
  const fut = diff < 0, m = Math.abs(diff) / 60e3;
  const s = m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  return fut ? `in ${s}` : `${s} ago`;
}
export const minsToHuman = (m: number) => (m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`);
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
export function median(xs: number[]) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
