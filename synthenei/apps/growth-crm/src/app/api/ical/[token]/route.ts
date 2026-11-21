// GET /api/ical/<token>[.ics]: public, token-authenticated availability feed for Airbnb / Booking.com to import. Only the SHA-256 of the
// token is stored. Per-IP rate limit first; every miss is the same 404. Other methods: 405. No cookies, no session.
import { NextResponse, type NextRequest } from "next/server";
import { handleFeedRequest } from "@/lib/connectors/ical";
import { icalServiceDeps } from "@/lib/connectors/ical/runtime";
import { clientIp } from "@/lib/auth/session";
import { LIMITS, rateLimit, rateLimitHeaders } from "@/lib/security/rate-limit";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (env.demoMode || !env.supabaseConfigured) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rl = await rateLimit("ical", clientIp(req.headers.get("x-forwarded-for")), LIMITS.api);
  if (!rl.ok) return new NextResponse("Too many requests\n", { status: 429, headers: { ...rateLimitHeaders(rl), "cache-control": "no-store" } });
  const { token } = await ctx.params;
  const r = await handleFeedRequest(icalServiceDeps(), token);
  return new NextResponse(r.body, { status: r.status, headers: r.headers });
}
const methodNotAllowed = () => new NextResponse("Method not allowed\n", { status: 405, headers: { allow: "GET", "cache-control": "no-store" } });
export const POST = methodNotAllowed, PUT = methodNotAllowed, PATCH = methodNotAllowed, DELETE = methodNotAllowed;
