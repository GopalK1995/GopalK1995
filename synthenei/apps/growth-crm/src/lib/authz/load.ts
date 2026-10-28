// Server-side principal loading and enforcement. Imports next/headers via auth/server: do not import from client code.
import { cache } from "react";
import { requireActive } from "../auth/server";
import { createSupabaseServerClient } from "../supabase/server";
import { MODULE_IDS } from "../config/types";
import { isModuleEnabled } from "../vertical";
import { AuthzError, decide } from "./engine";
import { principalFromMyGrants, systemPrincipal } from "./principal";
import type { Principal, RecordRef } from "./types";

/** Cached per request. Demo sessions: built from the fixture roles. Real sessions: `authz.my_grants(ws)` RPC. */
export const loadPrincipal = cache(async (ws?: string): Promise<Principal> => {
  const { session, active } = await requireActive();
  if (ws && ws !== active.ws.id) throw new AuthzError({ allow: false, reason: "out_of_scope", step: 1, permission: "workspace.access", maskedFields: [] });
  const modulesOff = MODULE_IDS.filter((m) => !isModuleEnabled(active.tenant, m));
  const base = {
    uid: session.uid, workspaceId: active.ws.id, role: active.role, tenantId: active.tenant.id, modulesOff,
    tenant: { status: active.tenant.status }, support: active.support ? { mode: active.support.mode } : null,
  };
  if (!session.demo) {
    const sb = await createSupabaseServerClient();
    if (sb) {
      const { data, error } = await sb.schema("authz").rpc("my_grants", { p_ws: active.ws.uuid });
      if (!error && data) {
        const p = principalFromMyGrants(data, { uid: session.uid, workspaceId: active.ws.id });
        return { ...p, modulesOff: [...new Set([...p.modulesOff, ...modulesOff])] };
      }
      // Transitional: until migration 0013 is applied the RPC does not exist; fall back to the membership role.
    }
  }
  return systemPrincipal(base);
});

/** For server actions and routes: throws AuthzError when denied, otherwise returns the principal. */
export async function assertCan(perm: string, rec?: RecordRef, ws?: string): Promise<Principal> {
  const p = await loadPrincipal(ws);
  const d = decide(p, perm, rec);
  if (!d.allow) throw new AuthzError(d);
  return p;
}
