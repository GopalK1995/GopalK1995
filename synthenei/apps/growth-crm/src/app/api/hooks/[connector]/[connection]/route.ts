// Inbound vendor webhooks: POST /api/hooks/[connector]/[connection] and GET (Meta hub.challenge). BUILD-PLAN 1.8, CONTRACTS C10.
// [connection] is the integration id (an unguessable v4 UUID). Raw body is read once; all logic lives in lib/connectors/verify/receive.
import { NextResponse, type NextRequest } from "next/server";
import { clientKey } from "@/lib/security/rate-limit";
import { receiveGet, receivePost, type ReceiveDeps, type ReceiveReq, type ReceiveRes } from "@/lib/connectors/verify/receive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

type Params = { params: Promise<{ connector: string; connection: string }> };

function toResponse(r: ReceiveRes): NextResponse | Response {
  if (r.text !== undefined) return new Response(r.text, { status: r.status, headers: r.headers });
  if (r.json !== undefined) return NextResponse.json(r.json, { status: r.status, headers: r.headers });
  return new Response(null, { status: r.status, headers: r.headers });
}
const gone = () => NextResponse.json({ ok: false }, { status: 404, headers: { "cache-control": "no-store" } });

async function handle(method: "GET" | "POST", req: NextRequest, ctx: Params) {
  const { connector, connection } = await ctx.params;
  let deps: ReceiveDeps;
  try { deps = (await import("@/lib/connectors/verify/runtime")).receiveDeps(); } catch { return gone(); }   // demo / unconfigured: nothing to say
  const url = new URL(req.url);
  const cl = req.headers.get("content-length");
  const r: ReceiveReq = {
    method, connector, connection, headers: req.headers, url: `${url.origin}${url.pathname}${url.search}`, query: url.searchParams,
    contentLength: cl && /^\d+$/.test(cl) ? Number(cl) : null, ip: clientKey(req.headers), readBody: () => req.text(),
  };
  try { return toResponse(method === "GET" ? await receiveGet(deps, r) : await receivePost(deps, r)); }
  catch { deps.log.error("webhook_receive_failed", { connector }); return NextResponse.json({ ok: false }, { status: 500, headers: { "cache-control": "no-store" } }); }
}

export const GET = (req: NextRequest, ctx: Params) => handle("GET", req, ctx);
export const POST = (req: NextRequest, ctx: Params) => handle("POST", req, ctx);
