// Meta "Data deletion request" callback: POST /api/meta/data-deletion (form field signed_request). Register this URL in the Meta app
// dashboard (Settings > Basic > Data deletion request URL). Answers {url, confirmation_code}; url is the public status page.
import { NextResponse, type NextRequest } from "next/server";
import { handleDeletionCallback, NotConfiguredError } from "@/lib/legal/meta-deletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

const H = { "cache-control": "no-store" };
const MAX_BODY = 16 * 1024;

export async function POST(req: NextRequest) {
  const len = req.headers.get("content-length");
  if (len && Number(len) > MAX_BODY) return NextResponse.json({ error: "invalid_signed_request" }, { status: 400, headers: H });
  let signed: unknown;
  try {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) signed = ((await req.json()) as { signed_request?: unknown } | null)?.signed_request;
    else signed = (await req.formData()).get("signed_request");
  } catch { return NextResponse.json({ error: "invalid_signed_request" }, { status: 400, headers: H }); }
  try {
    const { deletionDeps } = await import("@/lib/legal/meta-deletion-store");
    const r = await handleDeletionCallback(signed, deletionDeps());
    return NextResponse.json(r.body, { status: r.status, headers: H });
  } catch (e) {
    if (e instanceof NotConfiguredError) { console.error("[meta-deletion] meta_data_deletion_not_configured", { missing: e.message }); return NextResponse.json({ error: "not_configured" }, { status: 503, headers: H }); }
    console.error("[meta-deletion] meta_data_deletion_failed");
    return NextResponse.json({ error: "server_error" }, { status: 500, headers: H });
  }
}
