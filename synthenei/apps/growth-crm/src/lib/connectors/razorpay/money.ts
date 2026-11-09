// Money is integer minor units (paise for INR) end to end. Floats never touch an amount: decimal strings are parsed digit by digit.
const EXPONENT: Record<string, number> = {
  // zero-decimal currencies Razorpay lists, and the three-decimal ones
  JPY: 0, KRW: 0, VND: 0, CLP: 0, ISK: 0, UGX: 0, PYG: 0, RWF: 0, XAF: 0, XOF: 0, XPF: 0, KMF: 0, DJF: 0, GNF: 0, VUV: 0, BIF: 0, MGA: 0,
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3,
};
export const exponentOf = (currency: string): number => EXPONENT[currency.toUpperCase()] ?? 2;

export class MoneyError extends Error {
  constructor(public code: "invalid_amount" | "invalid_currency" | "too_large") { super(code); this.name = "MoneyError"; }
}

export const isCurrency = (c: unknown): c is string => typeof c === "string" && /^[A-Z]{3}$/.test(c);

/** Validates an amount already in minor units. Throws MoneyError. */
export function assertMinor(amount: unknown, max: number): number {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) throw new MoneyError("invalid_amount");
  if (amount > max) throw new MoneyError("too_large");
  return amount;
}

/** "1234.50" (major units, as typed in a form) -> 123450 minor units. Exact; more decimals than the currency allows are rejected. */
export function toMinor(major: string, currency: string, max: number): number {
  if (!isCurrency(currency)) throw new MoneyError("invalid_currency");
  const m = /^(\d{1,15})(?:\.(\d+))?$/.exec(major.trim());
  if (!m) throw new MoneyError("invalid_amount");
  const exp = exponentOf(currency), frac = m[2] ?? "";
  if (frac.length > exp) throw new MoneyError("invalid_amount");
  return assertMinor(Number(m[1] + frac.padEnd(exp, "0")), max);
}

/** 123450 -> "1234.50" for display and exports (string math on digits, no float division). */
export function fromMinor(minor: number, currency: string): string {
  const exp = exponentOf(currency);
  const neg = minor < 0, s = String(Math.abs(minor)).padStart(exp + 1, "0");
  const body = exp === 0 ? s : `${s.slice(0, s.length - exp)}.${s.slice(s.length - exp)}`;
  return neg ? `-${body}` : body;
}

/** Minor units from a deal's decimal rupee value (numeric(14,2) comes back as a number or string). Rounded half-up on the 2nd decimal. */
export function majorToMinorRounded(value: number | string, currency: string, max: number): number {
  const exp = exponentOf(currency);
  const s = typeof value === "number" ? value.toFixed(exp) : value;
  return toMinor(s, currency, max);
}
