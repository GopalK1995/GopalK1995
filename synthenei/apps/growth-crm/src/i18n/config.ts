// i18n configuration. No locale routing: locale comes from the cookie, then the profile, then Accept-Language, then English (en-IN).
export const LOCALES = ["en", "ta"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "gcrm_lang";
export const NAMESPACES = ["common", "shell", "auth", "errors"] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** Tamil UI is OFF until a fluent reviewer approves the drafts (owner blocker B-9). Set NEXT_PUBLIC_TAMIL_UI=1 to turn on. */
export const tamilUiEnabled = () => process.env.NEXT_PUBLIC_TAMIL_UI === "1";

/** Best supported locale named by an Accept-Language header (q-values honoured; "ta-IN" matches ta, "en-GB" matches en). Null when it names neither. */
export function parseAcceptLanguage(header?: string | null): Locale | null {
  if (!header) return null;
  const ranked = header.split(",").map((part, i) => {
    const [tag, ...params] = part.trim().split(";");
    const q = params.map((x) => x.trim()).find((x) => x.startsWith("q="));
    const w = q ? Number(q.slice(2)) : 1;
    return { lang: tag.trim().toLowerCase().split("-")[0], w: Number.isFinite(w) ? w : 0, i };
  }).filter((x) => x.w > 0 && isLocale(x.lang)).sort((a, b) => b.w - a.w || a.i - b.i);
  return ranked.length ? (ranked[0].lang as Locale) : null;
}

/**
 * Resolution order: the gcrm_lang cookie (an explicit choice on this device), then profiles.language, then the browser's Accept-Language,
 * then English. Tamil is ignored while the review gate is closed, so a stored "ta" falls back to English instead of half-translating.
 */
export function resolveLocale(cookieValue?: string | null, profileLanguage?: string | null, acceptLanguage?: string | null, tamilEnabled = tamilUiEnabled()): Locale {
  const pick = isLocale(cookieValue) ? cookieValue : isLocale(profileLanguage) ? profileLanguage : parseAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
  return pick === "ta" && !tamilEnabled ? DEFAULT_LOCALE : pick;
}

/** BCP-47 tag used for Intl and the html lang attribute. */
export const intlTag = (l: Locale) => (l === "ta" ? "ta-IN" : "en-IN");
