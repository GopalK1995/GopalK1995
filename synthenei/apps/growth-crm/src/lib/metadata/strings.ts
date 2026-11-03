// `fields` namespace lookup. Reads messages/{en,ta}/fields.json directly until the integrator registers the namespace in
// src/i18n/registry.ts (same approach as the api and leads namespaces). Pure: safe in server and client bundles.
// Tamil is a draft (`_review: true`); missing Tamil keys fall back to English.
import en from "../../../messages/en/fields.json";
import ta from "../../../messages/ta/fields.json";

export type FieldsLocale = "en" | "ta";
type Tree = Record<string, string | boolean>;

export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));
export function ft(key: string, vars: Record<string, string | number> = {}, locale: FieldsLocale = "en"): string {
  const v = (locale === "ta" ? (ta as Tree)[key] : undefined) ?? (en as Tree)[key];
  return typeof v === "string" ? fill(v, vars) : key;
}
/** Whole namespace for client components (placeholders stay as {x}). */
export function ftAll(locale: FieldsLocale = "en"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(en as Tree)) if (typeof v === "string") out[k] = v;
  if (locale === "ta") for (const [k, v] of Object.entries(ta as Tree)) if (typeof v === "string") out[k] = v;
  return out;
}
/** Translator over a strings object that was passed to a client component. */
export const tIn = (strings: Record<string, string>) => (key: string, vars: Record<string, string | number> = {}): string => fill(strings[key] ?? key, vars);

export const typeLabelKey = (type: string) => `type_${type}`;
