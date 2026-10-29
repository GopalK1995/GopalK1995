import { NextResponse, type NextRequest } from "next/server";
import { refreshSession } from "@/lib/auth/actions";
import { safeNext } from "@/lib/auth/cookies";

/** Re-signs the gcrm_session cookie from the current Supabase session (memberships and admin flag re-read from the database). */
export async function GET(req: NextRequest) {
  await refreshSession(safeNext(req.nextUrl.searchParams.get("next"))); // redirects
  return NextResponse.redirect(new URL("/", req.url));
}
