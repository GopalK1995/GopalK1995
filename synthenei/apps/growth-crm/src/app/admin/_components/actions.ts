"use server";
// Platform-admin write actions. Order in every action: requirePlatformAdmin (session) -> assertPlatform(platform.*) through the
// authz engine (role from platform_admins.platform_role) -> validate -> demo guard -> repository / RPC.
// Demo sessions never touch Supabase: each action validates and returns a sentence saying what would have happened.
// Real sessions call the repository in ../_lib/repo (RPCs re-check is_platform_admin() / super_admin in the database).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookieOpts } from "@/lib/auth/cookies";
import { SUPPORT_COOKIE, sign } from "@/lib/auth/session";
import { startSupport } from "@/lib/auth/actions";
import { AuthzError } from "@/lib/authz/engine";
import { dbForRequest, type Db } from "@/lib/db/client";
import { DbError } from "@/lib/db/errors";
import { MEMBERSHIPS, TENANTS, USERS, WORKSPACES } from "@/lib/tenancy";
import { assertPlatform, type PlatformCtx } from "../_lib/platform-session";
import type { PlatformPerm } from "../_lib/platform-authz";
import { checkPolicyPatch, diffPolicy } from "../_lib/policy";
import * as repo from "../_lib/repo";
import { at } from "../_lib/strings";

export type ActionResult = { ok: boolean; message: string; sub?: string; field?: string };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const demoSub = (demo: boolean) => (demo ? at("demoNotice") : undefined);

/** Runs one admin mutation behind its platform.* permission. AuthzError -> denied sentence; DbError -> mapped sentence; redirects pass through. */
async function guard(perm: PlatformPerm, fn: (ctx: PlatformCtx) => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn(await assertPlatform(perm));
  } catch (e) {
    if (e instanceof AuthzError) return { ok: false, message: at("deniedRole", { role: "platform", perm }) };
    if (e instanceof DbError) {
      if (e.code === "denied") return { ok: false, message: at("denied") };
      if (e.code === "unique") return { ok: false, field: "slug", message: "That slug is already used." };
      return { ok: false, message: at("loadError", { what: "the change", detail: e.detail ?? e.code }) };
    }
    throw e;
  }
}
async function realDb(): Promise<Db | null> {
  try { return await dbForRequest(); } catch { return null; }
}
const noDb = (): ActionResult => ({ ok: false, message: at("notConfigured") });

export async function createTenant(f: FormData): Promise<ActionResult> {
  return guard("platform.tenants.manage", async ({ session: me }) => {
    const name = s(f, "name"), slug = s(f, "slug"), brand = s(f, "brand") || name, hue = Number(s(f, "hue")), ws = s(f, "workspace"), owner = s(f, "owner");
    if (name.length < 2) return { ok: false, field: "name", message: "Enter the tenant's legal or trading name." };
    if (!SLUG.test(slug)) return { ok: false, field: "slug", message: "Slug: 3-32 lowercase letters, digits or hyphens." };
    if (!(hue >= 0 && hue <= 359)) return { ok: false, field: "hue", message: "Hue must be 0-359." };
    if (ws.length < 2) return { ok: false, field: "workspace", message: "Name the first workspace, e.g. Tamil Nadu." };
    if (!EMAIL.test(owner)) return { ok: false, field: "owner", message: "Enter the owner's email address." };
    if (me.demo) {
      if (TENANTS.some((t) => t.id === slug)) return { ok: false, field: "slug", message: at("slugTaken", { slug }) };
      return { ok: true, message: `Would create tenant ${name} (${slug}), workspace "${ws}", and invite ${owner} as Owner.`, sub: at("demoNotice") };
    }
    const db = await realDb();
    if (!db) return noDb();
    if (await repo.getTenantBySlug(db, slug)) return { ok: false, field: "slug", message: at("slugTaken", { slug }) };
    await repo.createTenant(db, { name, slug, branding: { brand_name: brand, brand_primary: `oklch(0.52 0.15 ${hue})` }, ownerEmail: owner, workspaceName: ws });
    revalidatePath("/admin/tenants");
    return { ok: true, message: at("tenantCreated", { name, ws, owner }) };
  });
}

export async function createWorkspace(f: FormData): Promise<ActionResult> {
  return guard("platform.tenants.manage", async ({ session: me }) => {
    const slug = s(f, "tenant"), name = s(f, "name"), region = s(f, "region");
    if (name.length < 2) return { ok: false, field: "name", message: "Name the workspace, e.g. Karnataka pilot." };
    if (me.demo) {
      const tenant = TENANTS.find((t) => t.id === slug);
      if (!tenant) return { ok: false, message: "Unknown tenant." };
      if (WORKSPACES.some((w) => w.tenantId === tenant.id && w.name.toLowerCase() === name.toLowerCase())) return { ok: false, field: "name", message: `${tenant.name} already has a workspace called ${name}.` };
      return { ok: true, message: `Would create workspace ${tenant.name} · ${name}${region ? ` (${region})` : ""}. It starts empty, with default pipeline stages.`, sub: at("demoNotice") };
    }
    const db = await realDb();
    if (!db) return noDb();
    const t = await repo.getTenantBySlug(db, slug);
    if (!t) return { ok: false, message: "Unknown tenant." };
    await repo.createWorkspace(db, t.id, name, region || null);
    revalidatePath(`/admin/tenants/${slug}`);
    return { ok: true, message: `Created workspace ${t.name} · ${name}${region ? ` (${region})` : ""}. It starts empty, with default pipeline stages.` };
  });
}

export async function inviteOwner(f: FormData): Promise<ActionResult> {
  return guard("platform.tenants.manage", async ({ session: me }) => {
    const wsId = s(f, "ws"), email = s(f, "email");
    if (!wsId) return { ok: false, field: "ws", message: "Choose a workspace." };
    if (!EMAIL.test(email)) return { ok: false, field: "email", message: "Enter a valid email address." };
    if (/@synthan\./i.test(email)) return { ok: false, field: "email", message: "Synthan operator addresses cannot hold workspace memberships. Use the client's own address." };
    if (me.demo) {
      const ws = WORKSPACES.find((w) => w.id === wsId);
      if (!ws) return { ok: false, field: "ws", message: "Choose a workspace." };
      const t = TENANTS.find((x) => x.id === ws.tenantId)!;
      return { ok: true, message: `Would invite ${email} as Owner of ${t.name} · ${ws.name}. The link expires in 7 days.`, sub: at("demoNotice") };
    }
    const db = await realDb();
    if (!db) return noDb();
    await repo.seatOwner(db, wsId, email);
    return { ok: true, message: `Invited ${email} as Owner. The link expires in 7 days.` };
  });
}

export async function setTenantStatus(f: FormData): Promise<ActionResult> {
  return guard("platform.tenants.manage", async ({ session: me }) => {
    const slug = s(f, "tenant"), to = s(f, "to") === "active" ? "active" : "suspended", confirm = s(f, "confirm");
    if (confirm !== slug) return { ok: false, field: "confirm", message: at("confirmMismatch", { slug }) };
    if (me.demo) {
      const t = TENANTS.find((x) => x.id === slug);
      if (!t) return { ok: false, message: "Unknown tenant." };
      const ws = WORKSPACES.filter((w) => w.tenantId === t.id).map((w) => w.id);
      const people = new Set(MEMBERSHIPS.filter((m) => ws.includes(m.workspaceId)).map((m) => m.userId)).size;
      return to === "suspended"
        ? { ok: true, message: `Would suspend ${t.name}: ${people} members across ${ws.length} workspace${ws.length > 1 ? "s" : ""} are signed out and cannot sign in. Data is kept.`, sub: at("demoNotice") }
        : { ok: true, message: `Would reactivate ${t.name}. Members can sign in again.`, sub: at("demoNotice") };
    }
    const db = await realDb();
    if (!db) return noDb();
    const t = await repo.getTenantBySlug(db, slug);
    if (!t) return { ok: false, message: "Unknown tenant." };
    await repo.setTenantStatus(db, t.id, to);
    revalidatePath("/admin", "layout");
    return { ok: true, message: at(to === "suspended" ? "tenantSuspended" : "tenantReactivated", { name: t.name }) };
  });
}

export async function saveBranding(f: FormData): Promise<ActionResult> {
  return guard("platform.tenants.manage", async ({ session: me }) => {
    const slug = s(f, "tenant"), name = s(f, "brand"), product = s(f, "product"), hue = Number(s(f, "hue"));
    if (name.length < 2) return { ok: false, field: "brand", message: "Brand name is required." };
    if (!(hue >= 0 && hue <= 359)) return { ok: false, field: "hue", message: "Hue must be 0-359." };
    if (me.demo) {
      const t = TENANTS.find((x) => x.id === slug);
      if (!t) return { ok: false, message: "Unknown tenant." };
      return { ok: true, message: `Would re-theme every ${t.name} workspace: ${name} · ${product || t.product}, hue ${hue}.`, sub: at("demoNotice") };
    }
    const db = await realDb();
    if (!db) return noDb();
    const t = await repo.getTenantBySlug(db, slug);
    if (!t) return { ok: false, message: "Unknown tenant." };
    await repo.setBranding(db, t.id, name, `oklch(0.52 0.15 ${hue})`);
    revalidatePath("/admin", "layout");
    return { ok: true, message: `Re-themed every ${t.name} workspace: ${name}, hue ${hue}.` };
  });
}

/** Org-admin policy editor. Super admin only (platform.policies.manage); the RPC repeats the check and audits `reason`. */
export async function saveOrgAdminPolicy(tenantSlug: string, patchIn: unknown, reasonIn: string): Promise<ActionResult> {
  return guard("platform.policies.manage", async ({ session: me }) => {
    const reason = String(reasonIn ?? "").trim();
    if (reason.length < 8) return { ok: false, field: "reason", message: at("reasonShort", { n: 8 }) };
    if (me.demo) {
      const t = TENANTS.find((x) => x.id === tenantSlug);
      if (!t) return { ok: false, message: "Unknown tenant." };
      const chk = checkPolicyPatch(patchIn, []);
      if (!chk.ok && chk.code === "badNumber") return { ok: false, field: chk.field, message: at("policyBadNumber") };
      return { ok: true, message: `Would save the org-admin policy for ${t.name}.`, sub: at("demoNotice") };
    }
    const db = await realDb();
    if (!db) return noDb();
    const t = await repo.getTenantBySlug(db, tenantSlug);
    if (!t) return { ok: false, message: "Unknown tenant." };
    const matrix = await repo.listConnectorMatrix(db);
    const chk = checkPolicyPatch(patchIn, matrix.map((c) => c.id));
    if (!chk.ok) return { ok: false, field: chk.field, message: chk.code === "badNumber" ? at("policyBadNumber") : at("policyBadList", { ids: (chk.ids ?? []).join(", ") || "see the catalogue" }) };
    const changed = diffPolicy(await repo.getPolicy(db, t.id), chk.patch);
    if (!Object.keys(changed).length) return { ok: false, message: at("policyNoChange") };
    await repo.setPolicy(db, t.id, changed, reason);
    revalidatePath(`/admin/tenants/${tenantSlug}`);
    return { ok: true, message: at("policySaved", { name: t.name }), sub: at("policySavedSub") };
  });
}

/** Connector availability matrix cell. Super admin only (RLS on connector_availability repeats it). */
export async function saveConnectorCell(f: FormData): Promise<ActionResult> {
  return guard("platform.policies.manage", async ({ session: me }) => {
    const connector = s(f, "connector"), env = s(f, "env") as repo.ConnectorEnv, mode = s(f, "mode") as repo.ConnectorMode, gate = s(f, "gate") as repo.GateStatus, note = s(f, "note");
    if (!repo.CONNECTOR_ENVS.includes(env) || !repo.CONNECTOR_MODES.includes(mode) || !repo.GATES.includes(gate) || !connector) return { ok: false, message: at("connectorBad") };
    if (note.length > 200) return { ok: false, field: "note", message: "Keep the note under 200 characters." };
    if (me.demo) return { ok: true, message: at("connectorSaved", { connector, mode, env }), sub: at("demoNotice") };
    const db = await realDb();
    if (!db) return noDb();
    if (!(await repo.listConnectorMatrix(db)).some((c) => c.id === connector)) return { ok: false, message: at("connectorBad") };
    await repo.setConnectorCell(db, { connectorId: connector, env, mode, gate, note: note || null });
    revalidatePath("/admin/connectors");
    return { ok: true, message: at("connectorSaved", { connector, mode, env }) };
  });
}

/** Start a support session (form action). Real: start_support_session RPC (20+ char reason, 15/30/60 min, one open session per admin),
 *  then the signed gcrm_support cookie that switches the app into the workspace with the amber banner. Demo: the in-process store. */
export async function startSupportSession(formData: FormData): Promise<void> {
  const ws = String(formData.get("ws") ?? "");
  let ctx: PlatformCtx;
  try { ctx = await assertPlatform("platform.support"); } catch (e) {
    if (e instanceof AuthzError) redirect(`/admin/support?ws=${encodeURIComponent(ws)}&error=role`);
    throw e;
  }
  if (ctx.session.demo) return startSupport(formData);
  const reason = String(formData.get("reason") ?? "").trim();
  const mode = formData.get("mode") === "read_write" ? "read_write" : "read_only";
  const mins = ([15, 30, 60] as const).find((m) => m === Number(formData.get("minutes"))) ?? 30;
  const back = (error: string): never => redirect(`/admin/support?ws=${encodeURIComponent(ws)}&error=${error}`);
  if (!/^[0-9a-f-]{36}$/i.test(ws)) back("ws");
  if (reason.length < 20) back("reason");
  if (mode === "read_write" && String(formData.get("reason2") ?? "").trim().length < 10) back("reason2");
  const db = await realDb();
  if (!db) back("rpc");
  let label = ws;
  try {
    const stats = await repo.workspaceStats(db!);
    const w = stats.find((x) => x.workspaceId === ws);
    if (!w) back("ws");
    label = `${w!.tenantName} · ${w!.workspaceName}`;
    await repo.startSupportSession(db!, { workspaceId: ws, reason: mode === "read_write" ? `${reason} | read-write: ${String(formData.get("reason2")).trim()}`.slice(0, 500) : reason, mode, minutes: mins });
  } catch (e) {
    if (e instanceof DbError) back("rpc");
    throw e;
  }
  const store = await cookies();
  store.set(SUPPORT_COOKIE, await sign({ ws, mode, reason, admin: ctx.session.name.split(" ")[0], endsAt: Date.now() + mins * 60e3, iat: Date.now(), label }), cookieOpts(mins * 60));
  redirect("/");
}

// ---- demo-only people actions: the real user directory is the org admin's (T017) -------------------------------------------------
export async function userAction(f: FormData): Promise<ActionResult> {
  return guard("platform.tenants.manage", async ({ session: me }) => {
    if (!me.demo) return { ok: false, message: "Member changes belong to the workspace's own Owner (Settings, Users). Open a support session for a read-only look." };
    const u = USERS.find((x) => x.id === s(f, "user")), kind = s(f, "kind");
    if (!u) return { ok: false, message: "Unknown user." };
    const sub = at("demoNotice");
    if (kind === "revoke_sessions") return { ok: true, message: `Would revoke all refresh tokens for ${u.name}. They sign in again on next request.`, sub };
    if (kind === "resend_invite") return { ok: true, message: `Would resend the invitation to ${u.email}.`, sub };
    if (kind === "deactivate") return { ok: true, message: `Would deactivate ${u.name} on every workspace. Memberships stay for audit.`, sub };
    return { ok: false, message: "Unknown action." };
  });
}

/** Platform admins are separate identities: a DB trigger rejects platform_admins for anyone with a membership. */
export async function grantPlatformAdmin(f: FormData): Promise<ActionResult> {
  return guard("platform.tenants.manage", async ({ session: me }) => {
    const email = s(f, "email").toLowerCase(), name = s(f, "name"), confirm = s(f, "confirm");
    if (name.length < 2) return { ok: false, field: "name", message: "Enter the operator's full name." };
    if (!EMAIL.test(email)) return { ok: false, field: "email", message: "Enter a valid email address." };
    if (!me.demo) return { ok: false, message: "Granting platform admin is SQL-only on live deployments: insert into public.platform_admins (user_id, platform_role) values ('<auth user id>', '<role>'). Run it from the Supabase SQL editor." };
    const member = USERS.find((u) => u.email.toLowerCase() === email && !u.platformAdmin);
    if (member) {
      const n = MEMBERSHIPS.filter((m) => m.userId === member.id).length;
      return { ok: false, field: "email", message: `${email} belongs to ${member.name}, who has ${n} workspace membership${n > 1 ? "s" : ""}. Platform admins must be separate identities; use a dedicated address such as platform+${member.name.split(" ")[0].toLowerCase()}@synthan.example.` };
    }
    if (!/@synthan\./.test(email)) return { ok: false, field: "email", message: "Platform admins use a Synthan address (platform+name@synthan.example)." };
    if (confirm !== "GRANT") return { ok: false, field: "confirm", message: "Type GRANT to confirm. This gives console access to every tenant's metadata." };
    if (!/^\d{6}$/.test(s(f, "code"))) return { ok: false, field: "code", message: "Re-enter your current 6-digit authenticator code." };
    return { ok: true, message: `Would invite ${name} (${email}) as platform admin. TOTP enrolment is required at first sign-in. Logged as platform_admin.granted.`, sub: at("demoNotice") };
  });
}

export async function revokePlatformAdmin(f: FormData): Promise<ActionResult> {
  return guard("platform.tenants.manage", async ({ session: me }) => {
    const id = s(f, "user"), name = s(f, "name");
    if (id === me.uid) return { ok: false, message: "You cannot revoke your own access. Another platform admin must do it." };
    if (!me.demo) return { ok: false, message: "Revoking platform admin is SQL-only on live deployments: update public.platform_admins set is_active = false where user_id = '<id>'." };
    return { ok: true, message: `Would revoke platform admin for ${name || id}. Their open support sessions end now.`, sub: at("demoNotice") };
  });
}

export async function exportAudit(): Promise<ActionResult> {
  return guard("platform.read", async ({ session: me }) => ({ ok: true, message: "Would export the filtered audit log as CSV (personal fields stay masked).", sub: demoSub(me.demo) }));
}
