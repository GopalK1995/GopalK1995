import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SUPPORT_COOKIE, WS_COOKIE, verifySession, verifySupport, type Session } from "./session";
import { resolveActive, type Active } from "./context";
import type { ActiveOption } from "../tenancy";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "../supabase/server";
import { loadMyWorkspaces } from "../tenancy";
import { getEffectiveConfig } from "../config/resolve";
import { toVerticalOverrides } from "../config/adapter";
import { isModuleEnabled, moduleForPath } from "../vertical";

/** my_workspaces() for the current request, cached per request. Null when Supabase is not configured or the call fails. */
const myWorkspaces = cache(async (): Promise<ActiveOption[] | null> => {
  const sb = await createSupabaseServerClient();
  return sb ? loadMyWorkspaces(sb) : null;
});

export async function getSession(): Promise<Session | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
/** Session + active workspace/role. Platform admins without a support session are sent to /admin. */
export async function requireActive(): Promise<{ session: Session; active: Active }> {
  const store = await cookies();
  const session = await requireSession();
  const support = session.platformAdmin ? await verifySupport(store.get(SUPPORT_COOKIE)?.value) : null;
  // Real sessions: tenant + workspace + role come from my_workspaces() (once per request). Cookie memberships are only
  // routing hints; RLS with the user's JWT remains the authoritative enforcement for every query.
  let options: ActiveOption[] | null = null;
  if (!session.demo) {
    options = await myWorkspaces();
    if (!session.platformAdmin) {
      // Revoked: nothing left, or (after the 10-minute grace window) the hinted workspace is gone.
      const stale = Date.now() - session.iat > 10 * 60e3;
      const hintGone = session.memberships.some((m) => m.ws === store.get(WS_COOKIE)?.value) && !options?.some((o) => o.ws.id === store.get(WS_COOKIE)?.value);
      if (options && (options.filter((o) => !o.viaSupport).length === 0 || (stale && hintGone))) redirect("/login?error=revoked");
    }
  }
  const active = resolveActive(session, store.get(WS_COOKIE)?.value, support, options);
  if (!active) redirect(session.platformAdmin ? "/admin" : "/login?error=no_profile");
  // Tenant configuration (preset + overrides) rides on the tenant object, so vocabFor(active.tenant) needs no changes.
  const cfg = await getEffectiveConfig(active.tenant.id);
  active.tenant = { ...active.tenant, name: cfg.branding.name, product: cfg.branding.product, hue: cfg.branding.hue, config: toVerticalOverrides(cfg) };
  // Module switch, second line of defence (middleware 403s demo sessions at the edge; real sessions are checked here).
  const path = (await headers()).get("x-pathname");
  const mod = path ? moduleForPath(path) : undefined;
  if (mod && !isModuleEnabled(active.tenant, mod)) redirect(`/forbidden?page=${encodeURIComponent(path!)}&off=1`);
  return { session, active };
}
export async function requirePlatformAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!s.platformAdmin) redirect("/forbidden?page=/admin");
  return s;
}
