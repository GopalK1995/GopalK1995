// RFC 8058 one-click unsubscribe: mail clients POST `List-Unsubscribe=One-Click` to the URL in the List-Unsubscribe header. The signed token is
// the credential. POST applies the withdrawal; GET (a person opening the link, or a scanner) only redirects to the confirmation page.
import { NextResponse, type NextRequest } from "next/server";
import { clientKey } from "@/lib/security/rate-limit";
import { applyUnsubscribe } from "@/lib/connectors/email/unsubscribe-apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" };

type Params = { params: Promise<{ token: string }> };

export async function POST(req: NextRequest, ctx: Params) {
  const { token } = await ctx.params;
  // The body must say One-Click (RFC 8058 section 3.1); anything else is not this protocol.
  const body = await req.text().catch(() => "");
  if (!/(^|&)List-Unsubscribe=One-Click(&|$)/.test(body)) return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE });
  let rt;
  try { rt = await (await import("@/lib/connectors/email/runtime")).serviceEmailRuntime(); } catch { return NextResponse.json({ ok: false }, { status: 404, headers: NO_STORE }); }   // demo / unconfigured
  if (!(await rt.deps.rate(`unsub-ip:${clientKey(req.headers)}`, 60, 60_000))) return NextResponse.json({ ok: false }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
  try {
    const out = await applyUnsubscribe(rt.deps.store, decodeURIComponent(token).slice(0, 1024), rt.deps.unsubscribeSecret, Date.now());
    return NextResponse.json({ ok: out.status === "done" }, { status: out.status === "done" ? 200 : 400, headers: NO_STORE });
  } catch { return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE }); }
}

export async function GET(req: NextRequest, ctx: Params) {
  const { token } = await ctx.params;
  return NextResponse.redirect(new URL(`/unsubscribe/${encodeURIComponent(decodeURIComponent(token).slice(0, 1024))}`, req.url), 307);
}
