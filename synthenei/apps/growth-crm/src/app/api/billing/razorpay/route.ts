// Synthan's own billing webhook (Razorpay Subscriptions): POST /api/billing/razorpay. Distinct from /api/hooks/razorpay/<connection>
// (a tenant's payments). Raw body, HMAC-SHA256 signature with RAZORPAY_WEBHOOK_SECRET, all logic in lib/billing/service handleWebhook.
import { NextResponse, type NextRequest } from "next/server";
import { billingDeps } from "@/lib/billing/runtime";
import { handleWebhook } from "@/lib/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;
const MAX_BYTES = 256 * 1024;
const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

export async function POST(req: NextRequest) {
  const cl = req.headers.get("content-length");
  if (cl && Number(cl) > MAX_BYTES) return json(413, { ok: false });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json(413, { ok: false });
  try {
    const r = await handleWebhook(billingDeps({ kind: "system" }), raw, req.headers.get("x-razorpay-signature"));
    if (!r.ok) return json(r.code === "bad_signature" ? 401 : 400, { ok: false });
    return json(200, { ok: true, outcome: r.data });
  } catch {
    return json(500, { ok: false });   // Razorpay retries a 5xx; every state change is idempotent
  }
}
