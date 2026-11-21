// Server context for the privacy pages and actions. Not a "use server" file. Demo never builds a database client.
import { requireActive } from "@/lib/auth/server";
import { assertCan, loadPrincipal } from "@/lib/authz/load";
import { can, type Principal } from "@/lib/authz";
import { dbForRequest, type Db } from "@/lib/db/client";
import { throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";

export interface PrCtx { demo: boolean; uid: string; ws: string; wsSlug: string; tenant: string; role: string; principal: Principal; support: boolean; db: Db | null }

/** Throws AuthzError unless the caller holds privacy.fulfil (support sessions are blocked by the catalogue). */
export async function fulfilCtx(): Promise<PrCtx> {
  const { session, active } = await requireActive();
  const demo = session.demo === true;
  const principal = await assertCan("privacy.fulfil");
  let db: Db | null = null, tenant = active.tenant.id;
  if (!demo) {
    db = await dbForRequest();
    const r = await from(db, "workspaces").select("tenant_id").eq("id", active.ws.uuid).maybeSingle();
    throwIfError(r.error);
    tenant = String((r.data as { tenant_id?: string } | null)?.tenant_id ?? "");
  }
  return { demo, uid: session.uid, ws: demo ? active.ws.id : active.ws.uuid, wsSlug: active.ws.id, tenant, role: active.role, principal, support: !!active.support, db };
}

export type Gate = { status: "denied"; reason: "support" | "role"; roleLabel: string } | { status: "ok"; demo: boolean; ws: string; wsSlug: string; tenant: string; role: string; principal: Principal; db: Db | null };

/** Soft check for pages: what the viewer may see. Real reads use the signed-in user's client (RLS). */
export async function gate(): Promise<Gate> {
  const { session, active } = await requireActive();
  if (active.support) return { status: "denied", reason: "support", roleLabel: active.role };
  const principal = await loadPrincipal();
  if (!can(principal, "privacy.fulfil")) return { status: "denied", reason: "role", roleLabel: active.role };
  const demo = session.demo === true;
  return { status: "ok", demo, ws: demo ? active.ws.id : active.ws.uuid, wsSlug: active.ws.id, tenant: active.tenant.id, role: active.role, principal, db: demo ? null : await dbForRequest() };
}
