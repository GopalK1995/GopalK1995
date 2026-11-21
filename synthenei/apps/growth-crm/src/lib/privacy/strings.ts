// `privacy` namespace lookup with flat dotted keys (like the email namespace). Tamil falls back to English per key.
// Pure and safe in server and client bundles; getPrT() is the server entry that reads the visitor's locale cookie.
import en from "../../../messages/en/privacy.json";
import ta from "../../../messages/ta/privacy.json";

type Loc = "en" | "ta";
const FILES: Record<Loc, Record<string, unknown>> = { en, ta };
const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));

export function prText(locale: Loc, key: string, vars: Record<string, string | number> = {}): string {
  const v = FILES[locale][key] ?? FILES.en[key];
  return typeof v === "string" ? fill(v, vars) : key;
}
export const makePrT = (locale: Loc) => (key: string, vars?: Record<string, string | number>) => prText(locale, key, vars);
export type PrT = ReturnType<typeof makePrT>;
/** The whole namespace for a client component (placeholders stay as {x}). */
export const prAll = (locale: Loc): Record<string, string> =>
  Object.fromEntries(Object.keys(FILES.en).filter((k) => !k.startsWith("_")).map((k) => [k, String(FILES[locale][k] ?? FILES.en[k])]));

export async function getPrT(): Promise<{ t: PrT; locale: Loc }> {
  const { getLocale } = await import("@/i18n/server");
  const locale: Loc = (await getLocale()) === "ta" ? "ta" : "en";
  return { t: makePrT(locale), locale };
}
