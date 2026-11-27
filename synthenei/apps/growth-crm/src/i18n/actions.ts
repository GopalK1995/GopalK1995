"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, isLocale, tamilUiEnabled } from "./config";
import { getSession } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type SetLocaleResult = { ok: boolean; /** The choice was also written to profiles.language (false for demo sessions, no backend, or a failed write: the cookie still applies). */ saved?: boolean; reason?: "invalid" | "unavailable" };

/**
 * Language switcher. Always writes the gcrm_lang cookie (works without the database and for demo sessions); for a real signed-in user it also
 * stores profiles.language so the choice follows them to other devices. Tamil is refused while the review gate is closed.
 */
export async function setLocale(locale: string): Promise<SetLocaleResult> {
  if (!isLocale(locale)) return { ok: false, reason: "invalid" };
  if (locale === "ta" && !tamilUiEnabled()) return { ok: false, reason: "unavailable" };
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  let saved = false;
  try {
    const session = await getSession();
    if (session && !session.demo) {
      const sb = await createSupabaseServerClient();
      if (sb) {
        const { data, error } = await sb.from("profiles").update({ language: locale }).eq("id", session.uid).select("id");
        saved = !error && (data?.length ?? 0) > 0;
      }
    }
  } catch { /* cookie path still works */ }
  revalidatePath("/", "layout");
  return { ok: true, saved };
}
