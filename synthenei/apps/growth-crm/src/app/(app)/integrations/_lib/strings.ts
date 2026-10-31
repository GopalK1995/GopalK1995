// `integrations` namespace lookup. Reads messages/<locale>/integrations.json directly until the integrator registers the
// namespace in src/i18n/registry.ts. Tamil is a machine draft flagged _review and falls back to English per key.
import en from "../../../../../messages/en/integrations.json";
import ta from "../../../../../messages/ta/integrations.json";

export type IntLocale = "en" | "ta";
const FILES: Record<IntLocale, Record<string, unknown>> = { en, ta };
const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));

export function tr(locale: IntLocale, key: string, vars: Record<string, string | number> = {}): string {
  const v = FILES[locale][key] ?? FILES.en[key];
  return typeof v === "string" ? fill(v, vars) : key;
}
export const makeT = (locale: IntLocale) => (key: string, vars?: Record<string, string | number>) => tr(locale, key, vars);
export type T = ReturnType<typeof makeT>;

/** Server-side: the signed-in user's locale. */
export async function getIntT(): Promise<T> {
  const { getLocale } = await import("@/i18n/server");
  return makeT((await getLocale()) === "ta" ? "ta" : "en");
}
