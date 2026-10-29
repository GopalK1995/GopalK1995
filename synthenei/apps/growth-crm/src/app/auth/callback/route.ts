import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { completeLogin } from "@/lib/auth/actions";
import { safeNext } from "@/lib/auth/cookies";

const LINK_TYPES = ["invite", "recovery", "signup", "email", "magiclink"] as const;

/** PKCE / OTP landing for Supabase emails. Exchanges the code, then continues (set-password for invite and reset links). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const sb = await createSupabaseServerClient();
  const fail = () => NextResponse.redirect(new URL("/login?error=link", req.url));
  if (!sb) return NextResponse.redirect(new URL("/login?error=no_backend", req.url));
  const next = safeNext(q.get("next"));
  const code = q.get("code"), hash = q.get("token_hash"), type = LINK_TYPES.find((t) => t === q.get("type"));
  let recovery = next?.startsWith("/auth/set-password") ?? false;
  if (code) {
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (error) return fail();
  } else if (hash && type) {
    const { error } = await sb.auth.verifyOtp({ token_hash: hash, type: type === "magiclink" ? "email" : type });
    if (error) return fail();
    recovery = recovery || type === "invite" || type === "recovery";
  } else return fail();
  if (recovery) return NextResponse.redirect(new URL("/auth/set-password", req.url));
  await completeLogin(next); // redirects
  return NextResponse.redirect(new URL("/", req.url));
}
