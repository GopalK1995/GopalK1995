// Shared server-side context for the org-admin actions: permission gate, demo flag, the caller's holdings.
// Not a "use server" file, so it can export consts and types. Demo never builds a database client.
import { requireActive } from "@/lib/auth/server";
import { assertCan } from "@/lib/authz/load";
import { AuthzError } from "@/lib/authz/engine";
import type { Grant, Principal } from "@/lib/authz/types";
import { dbForRequest, type Db } from "@/lib/db/client";
import { throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import type { Actor, BaseRole } from "./guards";

export type AdminPerm = "members.manage" | "members.invite" | "roles.manage" | "teams.manage";
/**
 * The demo fixture roles are generated from the legacy matrix, which only knows members.manage. In demo, the finer
 * keys fall back to it (roles.manage stays Owner-only). Real sessions use the keys exactly as seeded in the database.
 */
const DEMO_FALLBACK: Record<AdminPerm, string> = { "members.manage": "members.manage", "members.invite": "members.manage", "roles.manage": "members.manage", "teams.manage": "members.manage" };

export interface AdminCtx {
  demo: boolean;
  uid: string;
  ws: string; // workspace uuid (real) or slug (demo)
  tenant: string; // tenant uuid (real) or slug (demo)
  wsName: string;
  /** Request-scoped client; null in demo (a demo session never builds one). */
  db: Db | null;
  principal: Principal;
  actor: Actor;
  support: boolean;
}

export async function adminCtx(perm: AdminPerm): Promise<AdminCtx> {
  const { session, active } = await requireActive();
  const demo = session.demo === true;
  // Support sessions never administer people, roles or teams (member management is supportBlocked in the catalogue; teams.manage is not, so refuse here).
  if (active.support) throw new AuthzError({ allow: false, reason: "support_blocked", step: 4, permission: perm, maskedFields: [] });
  const principal = await assertCan(demo ? DEMO_FALLBACK[perm] : perm);
  if (demo && perm === "roles.manage" && active.role !== "owner") await assertCan("roles.manage"); // throws: not held in the fixture
  const held: Record<string, Grant> = { ...principal.grants };
  if (demo && active.role === "owner") for (const k of ["roles.manage", "members.invite", "teams.manage", "members.manage"]) held[k] = { scope: "all" };
  if (demo && active.role === "sales_manager") for (const k of ["members.invite", "teams.manage"]) held[k] = { scope: "all" };
  let db: Db | null = null, tenant = active.tenant.id;
  if (!demo) {
    db = await dbForRequest();
    const r = await from(db, "workspaces").select("tenant_id").eq("id", active.ws.uuid).maybeSingle();
    throwIfError(r.error);
    tenant = String((r.data as { tenant_id?: string } | null)?.tenant_id ?? "");
    if (!tenant) throw new AuthzError({ allow: false, reason: "out_of_scope", step: 1, permission: perm, maskedFields: [] });
  }
  return {
    demo, uid: session.uid, ws: demo ? active.ws.id : active.ws.uuid, tenant, db,
    wsName: active.ws.name, principal, support: !!active.support,
    actor: { uid: session.uid, baseRole: active.role as BaseRole, held },
  };
}
export const realDb = async (c: AdminCtx): Promise<Db> => {
  if (c.demo || !c.db) throw new Error("realDb called in demo");
  return c.db;
};
