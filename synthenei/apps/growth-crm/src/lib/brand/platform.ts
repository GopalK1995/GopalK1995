// Platform identity for copy that must not name the vendor or a customer (AUD-026). The name comes from configuration only:
// PLATFORM_PRODUCT_NAME on the server (also used by the legal pages), NEXT_PUBLIC_PLATFORM_NAME where a client component needs it.
// Unset = a neutral word, never a hard-coded company or product name. Pure and import-safe on server and client.
export type PlatformLocale = "en" | "ta";
const NEUTRAL: Record<PlatformLocale, string> = { en: "the platform", ta: "தளம்" };

const clean = (v: string | undefined): string | null => { const t = (v ?? "").trim(); return t === "" ? null : t; };

/** The configured platform name for running text ("Not set up by {platform}"). */
export function platformName(locale: PlatformLocale = "en", env: Record<string, string | undefined> = process.env): string {
  return clean(env.PLATFORM_PRODUCT_NAME) ?? clean(env.NEXT_PUBLIC_PLATFORM_NAME) ?? NEUTRAL[locale];
}
/** The configured product name for page titles, or null when none is set (callers then show the tenant brand alone). */
export function platformProduct(env: Record<string, string | undefined> = process.env): string | null {
  return clean(env.PLATFORM_PRODUCT_NAME) ?? clean(env.NEXT_PUBLIC_PLATFORM_NAME);
}
/** Replaces every {platform} token. Unknown tokens are left alone. */
export const fillPlatform = (text: string, locale: PlatformLocale = "en", env?: Record<string, string | undefined>): string =>
  text.replace(/\{platform\}/g, platformName(locale, env));
