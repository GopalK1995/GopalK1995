// Owner invoice PDF. Scoped to the caller's own tenant (RLS equivalent: billing.read), drafts hidden, never cached.
import { NextResponse } from "next/server";
import { requireActive } from "@/lib/auth/server";
import { decide } from "@/lib/authz/engine";
import { loadPrincipal } from "@/lib/authz/load";
import { billingDeps } from "@/lib/billing/runtime";
import { invoicePdf } from "@/lib/billing/service";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { session, active } = await requireActive();
  if (active.support || session.demo || !UUID.test(id)) return new NextResponse("Not found", { status: 404 });
  const p = await loadPrincipal();
  if (!p.tenantId || !decide(p, "billing.read").allow) return new NextResponse("Not found", { status: 404 });
  const r = await invoicePdf(billingDeps({ kind: "principal", principal: p }), id, p.tenantId);
  if (!r.ok) return new NextResponse(r.code === "issuer_unconfigured" ? "Invoice PDF is not configured" : "Not found", { status: r.code === "issuer_unconfigured" ? 503 : 404 });
  return new NextResponse(r.data.bytes as unknown as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${r.data.filename}"`, "cache-control": "private, no-store" } });
}
