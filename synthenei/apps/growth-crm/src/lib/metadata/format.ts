// Pure value helpers: E.164 phones, INR amounts (stored as rupees, a JSON number; paise helpers for arithmetic), IST dates.

/** E.164 for the digits typed by a user; bare 10-digit Indian mobiles get +91. Returns null when it cannot be a phone number. */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (/[^0-9+()\-.\s]/.test(raw)) return null;
  const hasPlus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");
  if (!hasPlus && digits.startsWith("00")) digits = digits.slice(2);
  else if (!hasPlus) {
    if (digits.length === 10 && /^[6-9]/.test(digits)) digits = `91${digits}`;
    else if (digits.length === 11 && digits.startsWith("0") && /^[6-9]/.test(digits.slice(1))) digits = `91${digits.slice(1)}`;
  }
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}
export const isE164 = (s: string): boolean => /^\+[1-9]\d{6,14}$/.test(s);

/** Money is stored in rupees (what metadata.check_value expects: a non-negative JSON number). Arithmetic goes through paise. */
export const rupeesToPaise = (r: number): number => Math.round(r * 100);
export const paiseToRupees = (p: number): number => Math.round(p) / 100;

/** Accepts "₹1,50,000.50", "Rs 2000", "INR 10". Returns NaN when it is not an amount. Result has at most 2 decimals. */
export function parseRupees(input: string | number): number {
  if (typeof input === "number") return Number.isFinite(input) ? paiseToRupees(rupeesToPaise(input)) : NaN;
  const s = input.trim().replace(/^(?:₹|rs\.?|inr)\s*/i, "").replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return paiseToRupees(rupeesToPaise(Number(s)));
}
export const formatInr = (rupees: number): string =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 }).format(rupees);

const IST_MS = 330 * 60_000;
const p2 = (n: number) => String(n).padStart(2, "0");

/** Real calendar date check for YYYY-MM-DD. */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** "02/11/2026" or "2-11-2026" (day first, as typed in India) to "2026-11-02"; other strings are returned unchanged. */
export function dmyToIso(s: string): string {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${p2(Number(m[2]))}-${p2(Number(m[1]))}` : s.trim();
}

/** "2026-11-02T14:30" typed in IST (no zone) to a UTC ISO instant. A string with a zone is normalised; anything else returns null. */
export function istInputToIso(s: string): string | null {
  const t = s.trim();
  const local = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(t);
  if (local) {
    if (!isIsoDate(local[1]) || Number(local[2]) > 23 || Number(local[3]) > 59) return null;
    const [y, mo, d] = local[1].split("-").map(Number);
    return new Date(Date.UTC(y, mo - 1, d, Number(local[2]), Number(local[3]), Number(local[4] ?? 0)) - IST_MS).toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  return null;
}

/** UTC instant to the value of an IST <input type="datetime-local">. */
export function isoToIstInput(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms + IST_MS);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDate(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return `${p2(d)} ${MONTHS[m - 1]} ${y}`;
}
export function formatIstDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms + IST_MS);
  const h = d.getUTCHours();
  return `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h % 12 === 0 ? 12 : h % 12}:${p2(d.getUTCMinutes())} ${h < 12 ? "am" : "pm"} IST`;
}
