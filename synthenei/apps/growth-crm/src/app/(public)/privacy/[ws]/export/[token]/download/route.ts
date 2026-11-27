// POST /privacy/<ws>/export/<token>/download: the one-time, address-checked delivery of an access bundle (AUD-064, PRIV-023).
// The page form posts here. redeemExport() does the work: signature, rate limits, the typed address must match the request's verified
// subject, the link is spent atomically, the delivery is audited BEFORE any data leaves, and the bundle is built now (nothing at rest).
// A wrong address spends nothing and goes back to the page with a message. The response is never cached and never indexed.
import { NextResponse, type NextRequest } from "next/server";
import { clientKey } from "@/lib/security/rate-limit";
import { supabaseConfigured } from "@/lib/supabase/server";
import { redeemExport } from "@/lib/privacy/dsr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };
const MAX_BODY = 4 * 1024;

export async function POST(req: NextRequest, ctx: { params: Promise<{ ws: string; token: string }> }): Promise<Response> {
  const { ws, token: raw } = await ctx.params;
  const slug = String(ws).slice(0, 60), token = decodeURIComponent(raw).slice(0, 200);
  const back = (code: string) => NextResponse.redirect(new URL(`/privacy/${encodeURIComponent(slug)}/export/${encodeURIComponent(token)}?e=${code}`, req.url), { status: 303, headers: HEADERS });
  const len = req.headers.get("content-length");
  if (len && Number(len) > MAX_BODY) return back("invalid");
  if (!supabaseConfigured()) return back("unavailable");
  let email = "";
  try { email = String((await req.formData()).get("email") ?? "").slice(0, 320); } catch { return back("invalid"); }
  let r: Awaited<ReturnType<typeof redeemExport>>;
  try {
    const { dsrDeps } = await import("@/lib/privacy/runtime");
    r = await redeemExport(dsrDeps(), { slug, token, email, ip: clientKey(req.headers) });
  } catch { return back("unavailable"); }
  if (r.status === "ok") {
    return new NextResponse(JSON.stringify(r.bundle, null, 2), {
      status: 200, headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${r.filename}"` },
    });
  }
  return back(r.status === "wrong_email" ? "email" : r.status === "rate_limited" ? "rate" : r.status === "no_lead" ? "nolead" : r.status === "unavailable" ? "unavailable" : "invalid");
}
