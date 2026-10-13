"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { HOME_FOR } from "./roles";
import { SESSION_COOKIE, SUPPORT_COOKIE, WS_COOKIE, sign, signSession, verifySession, verifySupport, type Session } from "./session";
import { createSupabaseServerClient } from "../supabase/server";
import { PERSONAS, membershipsFor, userById, workspaceById } from "../tenancy";
import type { Role } from "../data/types";

import { WS_MAX_AGE, cookieOpts as opts, demoModeOn, safeNext } from "./cookies";
import { logSupport } from "../support-log";
const cookieOpts = opts(60 * 60 * 12);
const demoAllowed = demoModeOn;

async function start(session: Session, next: string | null) {
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(session), cookieOpts);
  store.delete(SUPPORT_COOKIE);
  if (session.platformAdmin) redirect(next?.startsWith("/admin") ? next : "/admin");
  const last = store.get(WS_COOKIE)?.value;
  const m = session.memberships.find((x) => x.ws === last) ?? session.memberships[0];
  if (!m) redirect("/login?error=no_profile");
  store.set(WS_COOKIE, m.ws, opts(WS_MAX_AGE));
  redirect(next ?? HOME_FOR[m.role]);
}

function demoSession(userId: string): Session {
  const u = userById(userId)!;
  return { uid: u.id, name: u.name, email: u.email, demo: true, platformAdmin: !!u.platformAdmin, memberships: membershipsFor(u.id).map((m) => ({ ws: m.workspaceId, role: m.role })), iat: Date.now() };
}

export async function demoLogin(formData: FormData) {
  if (!demoAllowed()) redirect("/login?error=demo_disabled");
  const p = PERSONAS.find((x) => x.key === String(formData.get("persona")));
  if (!p) redirect("/login?error=role");
  await start(demoSession(p.userId), safeNext(formData.get("next")));
}

export async function passwordLogin(formData: FormData) {
  const email = String(formData.get("email") || "").trim(), password = String(formData.get("password") || "");
  const sb = await createSupabaseServerClient();
  if (!sb) redirect("/login?error=no_backend");
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) redirect("/login?error=credentials");
  // Profile per spec section 10 (`profiles`: full_name, is_active); memberships from RPC my_workspaces().
  const { data: profile } = await sb.from("profiles").select("full_name, is_active").eq("id", data.user.id).maybeSingle();
  if (profile?.is_active === false) { await sb.auth.signOut(); redirect("/login?error=inactive"); }
  const { data: ws } = await sb.rpc("my_workspaces");
  const memberships = ((ws as { workspace_id: string; role: Role }[] | null) ?? []).map((w) => ({ ws: w.workspace_id, role: w.role }));
  const { data: pa } = await sb.from("platform_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!memberships.length && !pa) { await sb.auth.signOut(); redirect("/login?error=no_profile"); }
  await start({ uid: data.user.id, name: (profile?.full_name as string) || email, email, demo: false, platformAdmin: !!pa, memberships, iat: Date.now() }, safeNext(formData.get("next")));
}

/** /admin/login: password, then a 6-digit code (MFA). Demo mode accepts any 6 digits and signs in the Synthan operator. */
export async function adminLogin(formData: FormData) {
  const code = String(formData.get("code") || "");
  if (!/^\d{6}$/.test(code)) redirect("/admin/login?step=code&error=code");
  if (!demoAllowed()) redirect("/admin/login?error=live_admin"); // live admin MFA goes through Supabase Auth MFA (not wired in demo)
  await start(demoSession("u-vikram"), safeNext(formData.get("next")));
}

export async function logout() {
  const store = await cookies();
  const s = await verifySession(store.get(SESSION_COOKIE)?.value);
  const sup = await verifySupport(store.get(SUPPORT_COOKIE)?.value);
  const sb = await createSupabaseServerClient();
  // Logging out ends any open support session (RPC in live mode; audit entry in both).
  if (s && sup) {
    if (!s.demo) await sb?.rpc("end_support_session", { p_workspace_id: sup.ws });
    logSupport({ admin: s.name, ws: sup.ws, action: "support_ended" });
  }
  if (sb) await sb.auth.signOut();
  const wasAdmin = s?.platformAdmin;
  store.delete(SESSION_COOKIE); store.delete(SUPPORT_COOKIE);
  redirect(wasAdmin ? "/admin/login?signed_out=1" : "/login?signed_out=1");
}

export async function switchWorkspace(wsId: string) {
  const store = await cookies();
  const s = await verifySession(store.get(SESSION_COOKIE)?.value);
  let m = s?.memberships.find((x) => x.ws === wsId);
  // Real sessions re-validate against my_workspaces() on every switch (cookie claims are routing hints only).
  if (s && !s.demo) {
    const sb = await createSupabaseServerClient();
    const { data } = sb ? await sb.rpc("my_workspaces") : { data: null };
    const live = ((data as { workspace_id: string; role: Role }[] | null) ?? []).find((w) => w.workspace_id === wsId);
    m = live ? { ws: live.workspace_id, role: live.role } : undefined;
  }
  if (!s || !m) redirect("/forbidden?page=/workspace");
  store.set(WS_COOKIE, wsId, opts(WS_MAX_AGE));
  redirect(HOME_FOR[m.role]);
}

/** start_support_session(): typed reason (20+ chars), mode, 15/30/60 min. Logged to the platform audit log. */
export async function startSupport(formData: FormData) {
  const store = await cookies();
  const s = await verifySession(store.get(SESSION_COOKIE)?.value);
  if (!s?.platformAdmin) redirect("/forbidden?page=/admin");
  const ws = String(formData.get("ws")), reason = String(formData.get("reason") || "").trim();
  const mode = formData.get("mode") === "read_write" ? "read_write" : "read_only";
  const mins = [15, 30, 60].includes(Number(formData.get("minutes"))) ? Number(formData.get("minutes")) : 30;
  if (!workspaceById(ws) || reason.length < 20) redirect(`/admin/support?ws=${ws}&error=reason`);
  if (mode === "read_write" && String(formData.get("reason2") || "").trim().length < 10) redirect(`/admin/support?ws=${ws}&error=reason2`);
  if (!s.demo) {
    const sb = await createSupabaseServerClient();
    const { error } = sb ? await sb.rpc("start_support_session", { p_workspace_id: ws, p_mode: mode, p_reason: reason, p_minutes: mins }) : { error: { message: "no client" } };
    if (error) redirect(`/admin/support?ws=${ws}&error=rpc`);
  }
  logSupport({ admin: s.name, ws, action: "support_started", mode, reason, minutes: mins });
  store.set(SUPPORT_COOKIE, await sign({ ws, mode, reason, admin: s.name.split(" ")[0], endsAt: Date.now() + mins * 60e3, iat: Date.now() }), opts(mins * 60));
  redirect("/");
}
export async function endSupport() {
  const store = await cookies();
  const s = await verifySession(store.get(SESSION_COOKIE)?.value);
  const sup = await verifySupport(store.get(SUPPORT_COOKIE)?.value);
  if (s && sup) {
    if (!s.demo) { const sb = await createSupabaseServerClient(); await sb?.rpc("end_support_session", { p_workspace_id: sup.ws }); }
    logSupport({ admin: s.name, ws: sup.ws, action: "support_ended" });
  }
  store.delete(SUPPORT_COOKIE);
  redirect("/admin?support=ended");
}
