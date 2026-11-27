// Server-side access without the next-intl plugin (next.config.mjs is not touched).
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createTranslator } from "next-intl";
import { LOCALE_COOKIE, isLocale, resolveLocale, type Locale } from "./config";
import { messagesFor, type MetadataLabels, type TenantI18nConfig } from "./layering";
import { getSession } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** profiles.language of the signed-in user, once per request. Null for visitors, demo sessions, no backend, or any failure (never throws). */
export const profileLanguage = cache(async (): Promise<string | null> => {
  try {
    const session = await getSession();
    if (!session || session.demo) return null;
    const sb = await createSupabaseServerClient();
    if (!sb) return null;
    const { data } = await sb.from("profiles").select("language").eq("id", session.uid).maybeSingle();
    return (data as { language?: string } | null)?.language ?? null;
  } catch { return null; }
});

export interface I18nOpts { profileLanguage?: string | null; tenantConfig?: TenantI18nConfig; labels?: MetadataLabels }
/** cookie, then profile, then Accept-Language, then en. The profile and header are read only when an earlier source did not decide. */
export async function getLocale(override?: string | null): Promise<Locale> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(cookie)) return resolveLocale(cookie);
  const profile = override ?? await profileLanguage();
  if (isLocale(profile)) return resolveLocale(null, profile);
  let accept: string | null = null;
  try { accept = (await headers()).get("accept-language"); } catch { /* no request scope */ }
  return resolveLocale(null, null, accept);
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
/** generateMetadata for a static page title: `export const generateMetadata = pageTitle("leads")` (keys live in the titles message files). */
export const pageTitle = (key: string) => async () => ({ title: (await getT("titles"))(key) });
