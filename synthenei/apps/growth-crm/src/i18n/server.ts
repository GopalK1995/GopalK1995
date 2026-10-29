// Server-side access without the next-intl plugin (next.config.mjs is not touched).
import "server-only";
import { cookies } from "next/headers";
import { createTranslator } from "next-intl";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./config";
import { messagesFor, type MetadataLabels, type TenantI18nConfig } from "./layering";

export interface I18nOpts { profileLanguage?: string | null; tenantConfig?: TenantI18nConfig; labels?: MetadataLabels }
export async function getLocale(profileLanguage?: string | null): Promise<Locale> {
  return resolveLocale(profileLanguage, (await cookies()).get(LOCALE_COOKIE)?.value);
}
export async function getMessages(opts: I18nOpts = {}) {
  const locale = await getLocale(opts.profileLanguage);
  return { locale, messages: messagesFor(locale, opts.tenantConfig, opts.labels) };
}
/** t() for RSC: `const t = await getT("shell"); t("signOut")`. */
export async function getT(namespace: string, opts: I18nOpts = {}) {
  const { locale, messages } = await getMessages(opts);
  return createTranslator({ locale, messages, namespace } as never) as (key: string, values?: Record<string, string | number>) => string;
}
