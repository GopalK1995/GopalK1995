// i18n configuration. No locale routing: locale comes from the profile, then a cookie, then English.
export const LOCALES = ["en", "ta"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "gcrm_lang";
export const NAMESPACES = ["common", "shell", "auth", "errors"] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** Tamil UI is OFF until a fluent reviewer approves the drafts (owner blocker B-9). Set NEXT_PUBLIC_TAMIL_UI=1 to turn on. */
export const tamilUiEnabled = () => process.env.NEXT_PUBLIC_TAMIL_UI === "1";

/** Profile language wins, then cookie, then English. Tamil is ignored while the review gate is closed. */
export function resolveLocale(profileLanguage?: string | null, cookieValue?: string | null, tamilEnabled = tamilUiEnabled()): Locale {
  const pick = isLocale(profileLanguage) ? profileLanguage : isLocale(cookieValue) ? cookieValue : DEFAULT_LOCALE;
  return pick === "ta" && !tamilEnabled ? DEFAULT_LOCALE : pick;
}

/** BCP-47 tag used for Intl and the html lang attribute. */
export const intlTag = (l: Locale) => (l === "ta" ? "ta-IN" : "en-IN");
