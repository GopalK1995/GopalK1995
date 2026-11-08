// Phone normaliser: any reasonable spelling of a number -> E.164, or null. Spreadsheet quirks are handled
// (numbers stored as 9.8765E+9, a trailing ".0", "00" international prefix, spaces, dashes, brackets).
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

/** Region used for numbers written without a country code. Callers may pass the workspace's region. */
export const DEFAULT_REGION: CountryCode = "IN";

export function normalisePhone(raw: unknown, region: CountryCode = DEFAULT_REGION): string | null {
  if (raw === null || raw === undefined) return null;
  let s = typeof raw === "number" ? (Number.isFinite(raw) ? raw.toFixed(0) : "") : String(raw).trim();
  if (!s) return null;
  if (/^\d+(\.0+)?$/.test(s)) s = s.replace(/\.0+$/, "");
  else if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) { const n = Number(s); if (!Number.isFinite(n)) return null; s = n.toFixed(0); }
  s = s.replace(/^\s*'/, "").replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!/^\+?\d{6,15}$/.test(s)) return null;
  const p = parsePhoneNumberFromString(s, region);
  return p && p.isValid() ? p.number : null;
}

/** Lower-cased, trimmed email or null when it is not a plausible address. */
export function normaliseEmail(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  return s.length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(s) ? s : null;
}
