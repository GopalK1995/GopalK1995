"use server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale, tamilUiEnabled } from "./config";

/** Per-session language override. Ignored for Tamil while the review gate is closed. */
export async function setLocale(locale: string): Promise<{ ok: boolean }> {
  if (!isLocale(locale) || (locale === "ta" && !tamilUiEnabled())) return { ok: false };
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return { ok: true };
}
