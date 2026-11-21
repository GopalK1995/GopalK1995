// GET /settings/privacy/<request id>/export: the access bundle as a JSON download.
// privacy.fulfil is asserted first (support sessions are blocked by the catalogue), the request must be an access request in the caller's
// workspace and linked to a record, the bundle is built on the caller's own client (RLS), and the download is audited BEFORE any data is
// returned: if the audit row cannot be written the bundle is not served. The response is never cached.
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthzError } from "@/lib/authz";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { buildAccessBundle } from "@/lib/privacy/bundle";
import { ownerRepo, RequestError } from "@/lib/privacy/owner";
import { fulfilCtx } from "../../_lib/ctx";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: HEADERS });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail(404, "not found");
  let c;
  try { c = await fulfilCtx(); } catch (e) { return e instanceof AuthzError ? fail(403, "forbidden") : fail(500, "error"); }
  if (c.demo || !c.db) return fail(409, "sample workspace: no data to export");
  try {
    const req = await ownerRepo(c.db, c.ws).get(id);
    if (req.kind !== "access") return fail(400, "not an access request");
    if (!req.leadId) return fail(409, "link a record first");
    await audit(actorFromPrincipal(c.principal), { action: "privacy.access_export", summary: "Access bundle downloaded", object: { table: "privacy_requests", id }, detail: { leadId: req.leadId } });
    const bundle = await buildAccessBundle(c.db, { workspaceId: c.ws, requestId: id, subjectRef: req.subjectRef, leadId: req.leadId });
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      status: 200, headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="access-bundle-${id.slice(0, 8)}.json"` },
    });
  } catch (e) {
    if (e instanceof RequestError) return fail(404, "not found");
    return fail(500, "error");
  }
}
