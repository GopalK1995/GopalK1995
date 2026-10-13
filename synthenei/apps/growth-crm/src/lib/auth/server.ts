import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SUPPORT_COOKIE, WS_COOKIE, verifySession, verifySupport, type Session } from "./session";
import { resolveActive, type Active } from "./context";
import { createSupabaseServerClient } from "../supabase/server";

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
  const active = resolveActive(session, store.get(WS_COOKIE)?.value, support);
  // Real sessions: cookie memberships are routing hints. Older than 10 min -> re-check my_workspaces(); RLS with the
  // user's JWT remains the authoritative enforcement for every query.
  if (active && !session.demo && !session.platformAdmin && Date.now() - session.iat > 10 * 60e3) {
    const sb = await createSupabaseServerClient();
    const { data } = sb ? await sb.rpc("my_workspaces") : { data: null };
    const live = ((data as { workspace_id: string; role: string }[] | null) ?? []).find((w) => w.workspace_id === active.ws.id);
    if (!live) redirect("/login?error=revoked");
    active.role = live.role as typeof active.role;
  }
  if (!active) redirect(session.platformAdmin ? "/admin" : "/login?error=no_profile");
  return { session, active };
}
export async function requirePlatformAdmin(): Promise<Session> {
  const s = await requireSession();
  if (!s.platformAdmin) redirect("/forbidden?page=/admin");
  return s;
}
