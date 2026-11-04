// `objects` namespace lookup (custom objects, layouts, saved views). Reads messages/{en,ta}/objects.json directly so client
// bundles and unit tests need no provider; the namespace is also registered in src/i18n/registry.ts for t() users.
// Tamil is a draft (`_review: true`); missing Tamil keys fall back to English. Pure.
import en from "../../../messages/en/objects.json";
import ta from "../../../messages/ta/objects.json";

export type ObjectsLocale = "en" | "ta";
type Tree = Record<string, string | boolean>;

export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));
export function ot(key: string, vars: Record<string, string | number> = {}, locale: ObjectsLocale = "en"): string {
  const v = (locale === "ta" ? (ta as Tree)[key] : undefined) ?? (en as Tree)[key];
  return typeof v === "string" ? fill(v, vars) : key;
}
/** Whole namespace for client components (placeholders stay as {x}). */
export function otAll(locale: ObjectsLocale = "en"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(en as Tree)) if (typeof v === "string") out[k] = v;
  if (locale === "ta") for (const [k, v] of Object.entries(ta as Tree)) if (typeof v === "string") out[k] = v;
  return out;
}
/** Translator over a strings object that was passed to a client component. */
export const tIn = (strings: Record<string, string>) => (key: string, vars: Record<string, string | number> = {}): string => fill(strings[key] ?? key, vars);
export type Tr = (key: string, vars?: Record<string, string | number>) => string;
export const trFor = (locale: ObjectsLocale): Tr => (key, vars) => ot(key, vars ?? {}, locale);
