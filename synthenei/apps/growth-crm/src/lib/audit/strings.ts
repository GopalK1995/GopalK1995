// `audit` namespace lookup. Reads messages/<locale>/audit.json directly until the integrator registers the namespace in
// src/i18n/registry.ts. Tamil falls back to English per key (the Tamil file is a machine draft flagged _review).
import en from "../../../messages/en/audit.json";
import ta from "../../../messages/ta/audit.json";

export type AuditLocale = "en" | "ta";
const FILES: Record<AuditLocale, Record<string, unknown>> = { en, ta };
export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));

export function tr(locale: AuditLocale, key: string, vars: Record<string, string | number> = {}): string {
  const v = FILES[locale][key] ?? FILES.en[key];
  return typeof v === "string" ? fill(v, vars) : key;
}
export const makeT = (locale: AuditLocale) => (key: string, vars?: Record<string, string | number>) => tr(locale, key, vars);
export type T = ReturnType<typeof makeT>;
