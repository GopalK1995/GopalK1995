// List export: rows -> CSV honouring PII masks. Pure. Authorisation (leads.export, support block, pii.read) happens in the server action;
// this module only decides how a value is shown once the caller says whether personal data is masked.
import { toCsv } from "./csv-guard";

export interface ExportColumn { key: string; label: string; isPii?: boolean }

/** Keeps enough of a value to recognise it (first character, domain, last digits) and hides the rest. */
export function maskValue(key: string, v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (!s) return "";
  if (key === "email" || /^[^\s@]+@[^\s@]+$/.test(s)) return s.replace(/^(.).*?(@.*)?$/, (_m, a: string, b?: string) => `${a}•••${b ?? ""}`);
  if (key === "phone" || /^\+?\d[\d\s-]{6,}$/.test(s)) return s.length > 5 ? `${s.slice(0, 3)}${"•".repeat(Math.max(3, s.length - 5))}${s.slice(-2)}` : "•••";
  return `${s[0]}•••`;
}

export function buildExportCsv(columns: ExportColumn[], rows: Record<string, unknown>[], opts: { maskPii: boolean }): string {
  const body = rows.map((r) => columns.map((c) => {
    const v = c.key.startsWith("custom.") ? (r.custom as Record<string, unknown> | undefined)?.[c.key.slice(7)] : r[c.key];
    if (v === null || v === undefined) return "";
    return opts.maskPii && c.isPii ? maskValue(c.key.replace(/^custom\./, ""), v) : Array.isArray(v) ? v.join("; ") : v;
  }));
  return toCsv(columns.map((c) => c.label), body, { bom: true });
}

/** `<object>-<yyyy-mm-dd>.csv`, never containing the workspace or tenant name. */
export const exportFileName = (object: string, now: Date): string => `${object.replace(/[^a-z0-9_-]/gi, "")}-${now.toISOString().slice(0, 10)}.csv`;
