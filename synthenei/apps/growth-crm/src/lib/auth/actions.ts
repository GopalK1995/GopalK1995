"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { HOME_FOR } from "./roles";
import { GENERIC_AUTH_ERROR, LOGIN_LIMIT, RESET_LIMIT, SESSION_COOKIE, SUPPORT_COOKIE, TOTP_RE, WS_COOKIE, buildLiveSession, clientIp, isAppCookie, mfaStep, passwordProblem, reSign, sign, signSession, throttleBucket, verifySession, verifySupport, type Session } from "./session";
import { createSupabaseServerClient } from "../supabase/server";
import { PERSONAS, membershipsFor, tenantOf, userById, workspaceById } from "../tenancy";
import { SIGNIN_SLUGS } from "../vertical";
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

type Sb = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
const qs = (o: Record<string, string | null | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ""; };

/** Fixed-window throttle through rate_limit_hit(). Fails open only if the RPC itself is unavailable (never blocks on infra errors). */
async function throttled(sb: Sb, kind: "login" | "reset", email: string, lim: { perEmail: number; perIp: number; windowS: number }) {
  const ip = clientIp((await headers()).get("x-forwarded-for"));
  const hit = async (dim: "email" | "ip", value: string, limit: number) => {
    const { data, error } = await sb.rpc("rate_limit_hit", { p_bucket: throttleBucket(kind, dim, value), p_limit: limit, p_window_s: lim.windowS });
    return error ? true : data !== false;
  };
  const a = await hit("email", email, lim.perEmail), b = await hit("ip", ip, lim.perIp);
  return !(a && b);
}

async function hasVerifiedTotp(sb: Sb) {
  const { data } = await sb.auth.mfa.listFactors();
  return !!data?.totp?.some((f) => f.status === "verified");
}

/** Read the Supabase user + database claims and build the signed cookie payload. Null when nobody is signed in. */
async function loadLiveSession(sb: Sb) {
  const { data: u } = await sb.auth.getUser();
  const user = u.user;
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("full_name, is_active").eq("id", user.id).maybeSingle();
  const { data: ws } = await sb.rpc("my_workspaces");
  const memberships = ((ws as { workspace_id: string; role: Role }[] | null) ?? []).map((w) => ({ ws: w.workspace_id, role: w.role }));
  const { data: pa } = await sb.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  return { user, inactive: profile?.is_active === false, platformAdmin: !!pa,
    session: buildLiveSession({ uid: user.id, email: user.email ?? "", fullName: profile?.full_name as string | null, platformAdmin: !!pa, memberships }) };
}

/** Common tail of every live sign-in path: profile, membership, MFA gate, then the signed cookie. */
async function finishLiveLogin(sb: Sb, next: string | null, via = "") {
  const live = await loadLiveSession(sb);
  if (!live) redirect("/login?error=credentials");
  const { session, platformAdmin } = live;
  if (live.inactive) { await sb.auth.signOut(); redirect("/login?error=inactive"); }
  if (!session.memberships.length && !platformAdmin) { await sb.auth.signOut(); redirect("/login?error=no_profile"); }
  const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  const step = mfaStep({ current: aal?.currentLevel, next: aal?.nextLevel }, { platformAdmin, hasVerifiedTotp: await hasVerifiedTotp(sb) });
  if (step !== "none") redirect(`/auth/mfa${qs({ enrol: step === "enrol" ? "1" : null, next, via })}`);
  // Client sign-in links (/g/<slug>) only admit members of that client.
  if (via && !platformAdmin && !session.memberships.some((m) => workspaceById(m.ws)?.tenantId === via)) { await sb.auth.signOut(); redirect(`/g/${via}?error=wrong_tenant`); }
  await start(session, next);
}

export async function passwordLogin(formData: FormData) {
  const email = String(formData.get("email") || "").trim(), password = String(formData.get("password") || "");
  const sb = await createSupabaseServerClient();
  if (!sb) redirect("/login?error=no_backend");
  if (await throttled(sb, "login", email, LOGIN_LIMIT)) redirect("/login?error=throttled");
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) redirect(`/login?error=${GENERIC_AUTH_ERROR}`);
  await finishLiveLogin(sb, safeNext(formData.get("next")), String(formData.get("tenant") || ""));
}

/** /admin/login: password, then a 6-digit code (MFA). Demo mode accepts any 6 digits and signs in the Synthan operator. */
export async function adminLogin(formData: FormData) {
  const code = String(formData.get("code") || "");
  if (!TOTP_RE.test(code)) redirect("/admin/login?step=code&error=code");
  const next = safeNext(formData.get("next"));
  const sb = await createSupabaseServerClient();
  if (!sb) {
    if (!demoAllowed()) redirect("/admin/login?error=live_admin");
    await start(demoSession("u-vikram"), next);
    return;
  }
  const email = String(formData.get("email") || "").trim(), password = String(formData.get("password") || "");
  if (demoAllowed() && !password) await start(demoSession("u-vikram"), next);
  if (await throttled(sb, "login", email, LOGIN_LIMIT)) redirect("/admin/login?error=throttled");
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) redirect(`/admin/login?step=code&error=${GENERIC_AUTH_ERROR}`);
  const { data: pa } = await sb.from("platform_admins").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!pa) { await sb.auth.signOut(); redirect(`/admin/login?step=code&error=${GENERIC_AUTH_ERROR}`); }
  const { data: factors } = await sb.auth.mfa.listFactors();
  const totp = factors?.totp?.find((f) => f.status === "verified");
  if (!totp) redirect(`/auth/mfa${qs({ enrol: "1", next })}`);
  const { error: mfaErr } = await sb.auth.mfa.challengeAndVerify({ factorId: totp.id, code });
  if (mfaErr) { await sb.auth.signOut(); redirect("/admin/login?step=code&error=code"); }
  await finishLiveLogin(sb, next);
}

/** Verify the 6-digit code for an existing or just-enrolled TOTP factor, then issue the session cookie. */
export async function verifyMfa(formData: FormData) {
  const factorId = String(formData.get("factorId") || ""), code = String(formData.get("code") || "");
  const next = safeNext(formData.get("next")), via = String(formData.get("via") || "");
  const back = (error: string) => `/auth/mfa${qs({ enrol: formData.get("enrol") ? "1" : null, next, via, error })}`;
  const sb = await createSupabaseServerClient();
  if (!sb) redirect("/login?error=no_backend");
  if (!factorId || !TOTP_RE.test(code)) redirect(back("code"));
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) redirect(back("code"));
  await finishLiveLogin(sb, next, via);
}

/** Forgot password. Always answers the same way, whether or not the address has an account. */
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const sb = await createSupabaseServerClient();
  if (!sb) redirect("/login?error=no_backend");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/auth/reset?error=email");
  if (!(await throttled(sb, "reset", email, RESET_LIMIT))) {
    const h = await headers();
    const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
    await sb.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/auth/set-password` });
  }
  redirect("/auth/reset?sent=1");
}

/** Invite and recovery links land on a page that posts here, so mail scanners that prefetch the link cannot burn the token. */
export async function acceptInvite(formData: FormData) {
  const token_hash = String(formData.get("token_hash") || ""), type = String(formData.get("type") || "invite");
  const sb = await createSupabaseServerClient();
  if (!sb) redirect("/login?error=no_backend");
  const t = (["invite", "recovery", "signup", "email"] as const).find((x) => x === type);
  if (!token_hash || !t) redirect("/login?error=link");
  const { error } = await sb.auth.verifyOtp({ token_hash, type: t });
  if (error) redirect("/login?error=link");
  redirect(`/auth/set-password${qs({ next: safeNext(formData.get("next")) })}`);
}

/** Set (or reset) the password for the signed-in invite/recovery user, then continue into the workspace. */
export async function setPassword(formData: FormData) {
  const pw = String(formData.get("password") || ""), confirm = String(formData.get("confirm") || "");
  const next = safeNext(formData.get("next"));
  const sb = await createSupabaseServerClient();
  if (!sb) redirect("/login?error=no_backend");
  const { data: u } = await sb.auth.getUser();
  if (!u.user) redirect("/login?error=link");
  const problem = passwordProblem(pw, confirm);
  if (problem) redirect(`/auth/set-password${qs({ error: problem, next })}`);
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) redirect(`/auth/set-password${qs({ error: "failed", next })}`);
  await finishLiveLogin(sb, next);
}

/** Exposed to /auth/callback and /auth/refresh. */
export async function completeLogin(next: string | null) {
  const sb = await createSupabaseServerClient();
  if (!sb) redirect("/login?error=no_backend");
  await finishLiveLogin(sb, next);
}

/** Re-sign the cookie from the current Supabase session (called on refresh); keeps the user where they were. */
export async function refreshSession(next: string | null) {
  const store = await cookies();
  const prev = await verifySession(store.get(SESSION_COOKIE)?.value);
  const sb = await createSupabaseServerClient();
  if (!prev || prev.demo || !sb) redirect(next ?? "/");
  const live = await loadLiveSession(sb);
  if (!live || live.inactive) { store.delete(SESSION_COOKIE); redirect("/login?error=revoked"); }
  store.set(SESSION_COOKIE, await signSession(reSign(prev, { platformAdmin: live.platformAdmin, memberships: live.session.memberships, fullName: live.session.name })), cookieOpts);
  redirect(next ?? "/");
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
  const tid = tenantOf(store.get(WS_COOKIE)?.value ?? "")?.id;
  store.delete(SESSION_COOKIE); store.delete(SUPPORT_COOKIE);
  // Clients return to their own branded link, not the internal hub.
  redirect(wasAdmin ? "/admin/login?signed_out=1" : tid && (SIGNIN_SLUGS as readonly string[]).includes(tid) && tid !== "lawsome" ? `/g/${tid}?signed_out=1` : "/login?signed_out=1");
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
