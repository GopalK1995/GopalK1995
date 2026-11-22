// `privacy` namespace lookup with flat dotted keys (like the email namespace). Tamil falls back to English per key.
// Pure and safe in server and client bundles: no import here (not even a dynamic one) reaches "server-only" code.
// The server entry that resolves the visitor's locale cookie is strings-server.ts, deliberately kept out of this
// file -- even a dynamic `import()` of next/headers-reaching code is enough for webpack to pull it into a client
// bundle that imports this module, which throws at build time.
import en from "../../../messages/en/privacy.json";
import ta from "../../../messages/ta/privacy.json";

export type Loc = "en" | "ta";
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
