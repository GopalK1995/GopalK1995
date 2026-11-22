// Platform invoice PDF (any tenant, drafts included). platform.billing or platform.read; platform admins only.
import { NextResponse } from "next/server";
import { billingDeps } from "@/lib/billing/runtime";
import { invoicePdf } from "@/lib/billing/service";
import { roleCan } from "../../../../_lib/platform-authz";
import { platformCtx } from "../../../../_lib/platform-session";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { session, role } = await platformCtx();
  if (session.demo || !UUID.test(id) || !(roleCan(role, "platform.billing") || roleCan(role, "platform.read"))) return new NextResponse("Not found", { status: 404 });
  const r = await invoicePdf(billingDeps({ kind: "platform", uid: session.uid }), id);
  if (!r.ok) return new NextResponse(r.code === "issuer_unconfigured" ? "Invoice PDF is not configured" : "Not found", { status: r.code === "issuer_unconfigured" ? 503 : 404 });
  return new NextResponse(r.data.bytes as unknown as BodyInit, { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${r.data.filename}"`, "cache-control": "private, no-store" } });
}
