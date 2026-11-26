// Server-side principal loading and enforcement. Imports next/headers via auth/server: do not import from client code.
import { cache } from "react";
import { requireActive } from "../auth/server";
import { createSupabaseServerClient } from "../supabase/server";
import { MODULE_IDS } from "../config/types";
import { isModuleEnabled } from "../vertical";
import { AuthzError, decide } from "./engine";
import { GrantsUnavailableError } from "./errors";
import { principalFromMyGrants, systemPrincipal } from "./principal";
import { SYSTEM_ROLES } from "./catalog/system-roles";
import { withBilling } from "../billing/runtime";
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
    // Real sessions fail CLOSED (AUD-003 / SEC-013): no client, an RPC error or an empty result never falls back to the legacy role matrix.
    const sb = await createSupabaseServerClient();
    if (!sb) {
      console.error("[authz] no Supabase client for a real session; denying", { ws: active.ws.id });
      throw new GrantsUnavailableError("no_client");
    }
    const { data, error } = await sb.schema("authz").rpc("my_grants", { p_ws: active.ws.uuid });
    if (error || !data) {
      console.error("[authz] my_grants lookup failed; denying", { ws: active.ws.id, code: error?.code ?? null, message: error?.message ?? "empty result" });
      throw new GrantsUnavailableError(error ? "rpc_error" : "empty_result");
    }
    const p = principalFromMyGrants(data, { uid: session.uid, workspaceId: active.ws.id });
    return withBilling({ ...p, modulesOff: [...new Set([...p.modulesOff, ...modulesOff])] });
  }
  const p = systemPrincipal(base);
  // Demo only: the legacy page matrix does not derive every seeded permission (audit.read, events.read, comments.*, ...), so the demo owner
  // could not read the audit log while the real owner can. Fill in what the frozen seed grants this role; derived grants and the support overlay win.
  const seeded = SYSTEM_ROLES.find((r) => r.key === p.roleKey);
  const grants = { ...p.grants };
  for (const [k, scope] of Object.entries(seeded?.grants ?? {})) if (!grants[k]) grants[k] = { scope };
  return { ...p, grants };
});

/** For server actions and routes: throws AuthzError when denied, otherwise returns the principal. */
export async function assertCan(perm: string, rec?: RecordRef, ws?: string): Promise<Principal> {
  const p = await loadPrincipal(ws);
  const d = decide(p, perm, rec);
  if (!d.allow) throw new AuthzError(d);
  return p;
}
