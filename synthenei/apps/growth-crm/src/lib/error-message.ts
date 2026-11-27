import en from "../../messages/en/errors.json";
import ta from "../../messages/ta/errors.json";

/** Boundary copy for any language. Imports the two small message files directly so it also works where no i18n provider exists
 * (root/admin/global boundaries). Tamil is used only when the document language is Tamil, which the server sets only while the Tamil UI is on. */
export type ErrorCopy = typeof en;
export type CopyKey = keyof ErrorCopy;
export function errorCopy(lang?: string | null): ErrorCopy {
  return (lang ?? "").toLowerCase().startsWith("ta") ? ta : en;
}
/** Client-side: the language of the page that is showing the boundary. */
export function docLang(): string {
  return typeof document === "undefined" ? "en" : document.documentElement.lang || "en";
}

/** In production Next replaces server error text with a generic sentence (plus a digest); showing that is noise, and in dev it can leak internals.
 * Never returns the raw error text: only one of three fixed sentences. */
export function humanMessage(error: { message?: string; digest?: string }, lang?: string | null): string {
  const c = errorCopy(lang), m = error.message ?? "";
  if (error.digest || !m || /Server Components render|omitted in production/i.test(m)) return c.boundaryBody;
  if (/^Could not read [a-z_]+:/i.test(m)) return c.boundaryBodyData;
  return c.boundaryBodyGeneric;
}

/** The id a person can quote: Next's digest when present (maps to the server log line), else a short client-made one that is logged with the error. */
export function errorId(error: { digest?: string }, fallback: string): string {
  return error.digest || fallback;
}
