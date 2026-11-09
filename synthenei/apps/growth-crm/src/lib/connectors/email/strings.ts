// `email` namespace lookup that tolerates dotted flat keys (like the integrations namespace). Tamil falls back to English per key.
// Pure and safe in server and client bundles; getEmT() is the server-side entry that reads the signed-in (or cookie) locale.
import en from "../../../../messages/en/email.json";
import ta from "../../../../messages/ta/email.json";

type Loc = "en" | "ta";
const FILES: Record<Loc, Record<string, unknown>> = { en, ta };
const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));

export function emText(locale: Loc, key: string, vars: Record<string, string | number> = {}): string {
  const v = FILES[locale][key] ?? FILES.en[key];
  return typeof v === "string" ? fill(v, vars) : key;
}
export const makeEmT = (locale: Loc) => (key: string, vars?: Record<string, string | number>) => emText(locale, key, vars);
export type EmT = ReturnType<typeof makeEmT>;
/** The whole namespace for a client component (placeholders stay as {x}). */
export const emAll = (locale: Loc): Record<string, string> => Object.fromEntries(Object.keys(FILES.en).filter((k) => !k.startsWith("_")).map((k) => [k, String(FILES[locale][k] ?? FILES.en[k])]));

export async function getEmT(): Promise<{ t: EmT; locale: Loc }> {
  const { getLocale } = await import("@/i18n/server");
  const locale: Loc = (await getLocale()) === "ta" ? "ta" : "en";
  return { t: makeEmT(locale), locale };
}
