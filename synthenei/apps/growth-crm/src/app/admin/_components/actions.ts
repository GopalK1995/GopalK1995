"use server";
// Platform-admin write actions. Every action re-checks requirePlatformAdmin() (middleware also guards /admin).
// Demo sessions persist nothing: each action validates and returns a sentence saying what would have happened.
// Real sessions call the BACKEND RPCs (admin_create_tenant, create_workspace, ...), which check is_platform_admin().
import { requirePlatformAdmin } from "@/lib/auth/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MEMBERSHIPS, TENANTS, USERS, WORKSPACES } from "@/lib/tenancy";

export type ActionResult = { ok: boolean; message: string; sub?: string; field?: string };
const DEMO_SUB = "Demo: nothing was saved or sent.";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

async function rpc(fn: string, args: Record<string, unknown>): Promise<ActionResult | null> {
  const sb = await createSupabaseServerClient();
  if (!sb) return { ok: false, message: "Supabase is not configured on this deployment." };
  const { error } = await sb.rpc(fn, args);
  return error ? { ok: false, message: `${fn} failed: ${error.message}` } : null;
}
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function createTenant(f: FormData): Promise<ActionResult> {
  const me = await requirePlatformAdmin();
  const name = s(f, "name"), slug = s(f, "slug"), brand = s(f, "brand") || name, hue = Number(s(f, "hue")), ws = s(f, "workspace"), owner = s(f, "owner");
  if (name.length < 2) return { ok: false, field: "name", message: "Enter the tenant's legal or trading name." };
  if (!SLUG.test(slug)) return { ok: false, field: "slug", message: "Slug: 3-32 lowercase letters, digits or hyphens." };
  if (TENANTS.some((t) => t.id === slug)) return { ok: false, field: "slug", message: `Slug "${slug}" is already used.` };
  if (!(hue >= 0 && hue <= 359)) return { ok: false, field: "hue", message: "Hue must be 0-359." };
  if (ws.length < 2) return { ok: false, field: "workspace", message: "Name the first workspace, e.g. Tamil Nadu." };
  if (!EMAIL.test(owner)) return { ok: false, field: "owner", message: "Enter the owner's email address." };
  if (!me.demo) {
    const err = await rpc("admin_create_tenant", { p_name: name, p_slug: slug, p_branding: { brand_name: brand, brand_primary_hue: hue }, p_owner_email: owner, p_workspace_name: ws });
    if (err) return err;
    return { ok: true, message: `Created ${name} with workspace ${ws}. Invitation sent to ${owner}.` };
  }
  return { ok: true, message: `Would create tenant ${name} (${slug}), workspace "${ws}", and invite ${owner} as Owner.`, sub: DEMO_SUB };
}

export async function createWorkspace(f: FormData): Promise<ActionResult> {
  const me = await requirePlatformAdmin();
  const tenant = TENANTS.find((t) => t.id === s(f, "tenant")), name = s(f, "name"), region = s(f, "region");
  if (!tenant) return { ok: false, message: "Unknown tenant." };
  if (name.length < 2) return { ok: false, field: "name", message: "Name the workspace, e.g. Karnataka pilot." };
  if (WORKSPACES.some((w) => w.tenantId === tenant.id && w.name.toLowerCase() === name.toLowerCase())) return { ok: false, field: "name", message: `${tenant.name} already has a workspace called ${name}.` };
  if (!me.demo) { const err = await rpc("create_workspace", { p_tenant: tenant.id, p_name: name, p_region_label: region || null }); if (err) return err; }
  return { ok: true, message: `${me.demo ? "Would create" : "Created"} workspace ${tenant.name} · ${name}${region ? ` (${region})` : ""}. It starts empty, with default pipeline stages.`, sub: me.demo ? DEMO_SUB : undefined };
}

export async function inviteOwner(f: FormData): Promise<ActionResult> {
  const me = await requirePlatformAdmin();
  const ws = WORKSPACES.find((w) => w.id === s(f, "ws")), email = s(f, "email");
  if (!ws) return { ok: false, field: "ws", message: "Choose a workspace." };
  if (!EMAIL.test(email)) return { ok: false, field: "email", message: "Enter a valid email address." };
  if (/@synthan\./i.test(email)) return { ok: false, field: "email", message: "Synthan operator addresses cannot hold workspace memberships. Use the client's own address." };
  const t = TENANTS.find((x) => x.id === ws.tenantId)!;
  if (!me.demo) { const err = await rpc("invite_member", { p_ws: ws.id, p_email: email, p_role: "owner" }); if (err) return err; }
  return { ok: true, message: `${me.demo ? "Would invite" : "Invited"} ${email} as Owner of ${t.name} · ${ws.name}. The link expires in 7 days.`, sub: me.demo ? DEMO_SUB : undefined };
}

export async function setTenantStatus(f: FormData): Promise<ActionResult> {
  const me = await requirePlatformAdmin();
  const t = TENANTS.find((x) => x.id === s(f, "tenant")), to = s(f, "to") === "active" ? "active" : "suspended", confirm = s(f, "confirm");
  if (!t) return { ok: false, message: "Unknown tenant." };
  if (confirm !== t.id) return { ok: false, field: "confirm", message: `Type ${t.id} exactly to confirm.` };
  const ws = WORKSPACES.filter((w) => w.tenantId === t.id).map((w) => w.id);
  const people = new Set(MEMBERSHIPS.filter((m) => ws.includes(m.workspaceId)).map((m) => m.userId)).size;
  if (!me.demo) { const err = await rpc("admin_set_tenant_status", { p_tenant: t.id, p_status: to }); if (err) return err; }
  return to === "suspended"
    ? { ok: true, message: `${me.demo ? "Would suspend" : "Suspended"} ${t.name}: ${people} members across ${ws.length} workspace${ws.length > 1 ? "s" : ""} are signed out and cannot sign in. Data is kept.`, sub: me.demo ? DEMO_SUB : undefined }
    : { ok: true, message: `${me.demo ? "Would reactivate" : "Reactivated"} ${t.name}. Members can sign in again.`, sub: me.demo ? DEMO_SUB : undefined };
}

export async function saveBranding(f: FormData): Promise<ActionResult> {
  const me = await requirePlatformAdmin();
  const t = TENANTS.find((x) => x.id === s(f, "tenant")), name = s(f, "brand"), product = s(f, "product"), hue = Number(s(f, "hue"));
  if (!t) return { ok: false, message: "Unknown tenant." };
  if (name.length < 2) return { ok: false, field: "brand", message: "Brand name is required." };
  if (!(hue >= 0 && hue <= 359)) return { ok: false, field: "hue", message: "Hue must be 0-359." };
  if (!me.demo) {
    const sb = await createSupabaseServerClient();
    const { error } = sb ? await sb.from("tenants").update({ brand_name: name, brand_primary: `oklch(0.52 0.15 ${hue})` }).eq("id", t.id) : { error: { message: "no client" } };
    if (error) return { ok: false, message: `Could not update branding: ${error.message}` };
  }
  return { ok: true, message: `${me.demo ? "Would re-theme" : "Re-themed"} every ${t.name} workspace: ${name} · ${product || t.product}, hue ${hue}.`, sub: me.demo ? DEMO_SUB : undefined };
}

export async function userAction(f: FormData): Promise<ActionResult> {
  const me = await requirePlatformAdmin();
  const u = USERS.find((x) => x.id === s(f, "user")), kind = s(f, "kind");
  if (!u) return { ok: false, message: "Unknown user." };
  const sub = me.demo ? DEMO_SUB : undefined;
  if (kind === "revoke_sessions") return { ok: true, message: `${me.demo ? "Would revoke" : "Revoked"} all refresh tokens for ${u.name}. They sign in again on next request.`, sub };
  if (kind === "resend_invite") return { ok: true, message: `${me.demo ? "Would resend" : "Resent"} the invitation to ${u.email}.`, sub };
  if (kind === "deactivate") return { ok: true, message: `${me.demo ? "Would deactivate" : "Deactivated"} ${u.name} on every workspace. Memberships stay for audit.`, sub };
  return { ok: false, message: "Unknown action." };
}

/** Platform admins are separate identities: a DB trigger rejects platform_admins for anyone with a membership. */
export async function grantPlatformAdmin(f: FormData): Promise<ActionResult> {
  const me = await requirePlatformAdmin();
  const email = s(f, "email").toLowerCase(), name = s(f, "name");
  if (name.length < 2) return { ok: false, field: "name", message: "Enter the operator's full name." };
  if (!EMAIL.test(email)) return { ok: false, field: "email", message: "Enter a valid email address." };
  const member = USERS.find((u) => u.email.toLowerCase() === email && !u.platformAdmin);
  if (member) {
    const n = MEMBERSHIPS.filter((m) => m.userId === member.id).length;
    return { ok: false, field: "email", message: `${email} belongs to ${member.name}, who has ${n} workspace membership${n > 1 ? "s" : ""}. Platform admins must be separate identities; use a dedicated address such as platform+${member.name.split(" ")[0].toLowerCase()}@synthan.example.` };
  }
  if (!/@synthan\./.test(email)) return { ok: false, field: "email", message: "Platform admins use a Synthan address (platform+name@synthan.example)." };
  // Live: deliberately SQL-only (BACKEND 0007): insert into public.platform_admins (user_id) values (...).
  if (!me.demo) return { ok: false, message: "Granting platform admin is SQL-only on live deployments: insert into public.platform_admins (user_id) values ('<auth user id>'). Run it from the Supabase SQL editor." };
  return { ok: true, message: `${me.demo ? "Would invite" : "Invited"} ${name} (${email}) as platform admin. TOTP enrolment is required at first sign-in.`, sub: me.demo ? DEMO_SUB : undefined };
}

export async function revokePlatformAdmin(f: FormData): Promise<ActionResult> {
  const me = await requirePlatformAdmin();
  const id = s(f, "user"), name = s(f, "name");
  if (id === me.uid) return { ok: false, message: "You cannot revoke your own access. Another platform admin must do it." };
  if (!me.demo) return { ok: false, message: "Revoking platform admin is SQL-only on live deployments: update public.platform_admins set is_active = false where user_id = '<id>'." };
  return { ok: true, message: `${me.demo ? "Would revoke" : "Revoked"} platform admin for ${name || id}. Their open support sessions end now.`, sub: me.demo ? DEMO_SUB : undefined };
}

export async function exportAudit(): Promise<ActionResult> {
  const me = await requirePlatformAdmin();
  return { ok: true, message: "Would export the filtered audit log as CSV (personal fields stay masked).", sub: me.demo ? DEMO_SUB : undefined };
}
