// Server context for the integrations actions and pages. Not a "use server" file. Demo never builds a database client.
import { requireActive } from "@/lib/auth/server";
import { assertCan, loadPrincipal } from "@/lib/authz/load";
import { can, type Principal } from "@/lib/authz";
import { dbForRequest, type Db } from "@/lib/db/client";
import { throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";

export interface IntCtx { demo: boolean; uid: string; ws: string; tenant: string; role: string; principal: Principal; support: boolean; db: Db | null }

/** Throws AuthzError unless the caller may manage integrations (support sessions are blocked by the catalogue). */
export async function manageCtx(): Promise<IntCtx> {
  const { session, active } = await requireActive();
  const demo = session.demo === true;
  const principal = await assertCan("integrations.manage");
  let db: Db | null = null, tenant = active.tenant.id;
  if (!demo) {
    db = await dbForRequest();
    const r = await from(db, "workspaces").select("tenant_id").eq("id", active.ws.uuid).maybeSingle();
    throwIfError(r.error);
    tenant = String((r.data as { tenant_id?: string } | null)?.tenant_id ?? "");
  }
  return { demo, uid: session.uid, ws: demo ? active.ws.id : active.ws.uuid, tenant, role: active.role, principal, support: !!active.support, db };
}

/** Soft check for pages: what the viewer may see and do. */
export async function viewCtx() {
  const { session, active } = await requireActive();
  const principal = await loadPrincipal();
  return {
    demo: session.demo === true, uid: session.uid, role: active.role, ws: active.ws.uuid, vertical: active.tenant.vertical ?? "legal",
    canRead: can(principal, "integrations.read"), canManage: can(principal, "integrations.manage"), support: !!active.support, principal,
  };
}
