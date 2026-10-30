// Server side: resolve the caller's platform role and enforce platform.* permissions.
import { requirePlatformAdmin } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import { assertPlatformFor, asPlatformRole, roleCan, type PlatformPerm, type PlatformRole } from "./platform-authz";

export interface PlatformCtx { session: Session; role: PlatformRole }

/** Demo platform admins act as super_admin. Real: read platform_admins.platform_role; inactive or unreadable = readonly. */
export async function platformCtx(): Promise<PlatformCtx> {
  const session = await requirePlatformAdmin();
  if (session.demo) return { session, role: "super_admin" };
  const sb = await createSupabaseServerClient();
  if (!sb) return { session, role: "readonly" };
  const { data } = await sb.from("platform_admins").select("platform_role,is_active").eq("user_id", session.uid).maybeSingle();
  const row = data as { platform_role?: string; is_active?: boolean } | null;
  return { session, role: row && row.is_active !== false ? asPlatformRole(row.platform_role) : "readonly" };
}

/** For every admin server action and page: throws AuthzError (use runAdmin) when the platform role lacks `perm`. */
export async function assertPlatform(perm: PlatformPerm): Promise<PlatformCtx> {
  const ctx = await platformCtx();
  assertPlatformFor(ctx.session.uid, ctx.role, perm);
  return ctx;
}
export async function platformCan(perm: PlatformPerm): Promise<boolean> {
  const { role } = await platformCtx();
  return roleCan(role, perm);
}
