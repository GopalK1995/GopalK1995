"use server";
// Settings mutations. Member administration (invite, change role, suspend, reactivate, territories) is real: each action
// runs assertCan, the privilege-escalation guards (settings/roles/_lib/guards.ts), then the repositories/RPCs; RLS and the
// guard triggers of migrations 0005/0013 are the second line. Demo sessions validate and answer, and never build a client.
// Branding, pipeline and erasure below are unchanged (demo-only until their owning tasks).
import { requireActive } from "@/lib/auth/server";
import { can } from "@/lib/auth/roles";
import { failResult, okResult, type ActionResult as Result } from "@/lib/actions/result";
import { DbError } from "@/lib/db/errors";
import { adminCtx, realDb, type AdminCtx } from "../roles/_lib/ctx";
import { checkMemberChange, checkRoleAssignment } from "../roles/_lib/guards";
import { act, customRolesBlocked, loadWorld, refOf, roleOfMember, rpc, verdict } from "../roles/_lib/ops";
import { attributesSchema, changeRoleSchema, inviteSchema, memberIdSchema } from "../roles/_lib/schemas";
import { activeOwnerCount, setMemberActive, setMemberAttributes, setMemberRole } from "../roles/_lib/store";
import { sa } from "../roles/_lib/strings";
import { contrastChecks } from "./contrast";

export type ActionResult = { ok: boolean; message: string; detail?: string };
const DEMO = "Demo: nothing was saved or sent.";
const SUPPORT = { ok: false, message: "Not available in a support session." } as const;
const notFound = () => failResult("not_found", sa("memberNotFound"));

/** Invite: real invite_member RPC (existing confirmed user is added at once, new user gets an invitation row) then the
 *  admin invite email. A custom role is applied right away for an existing user; for a new user it is applied after accept. */
export async function inviteMember(input: { email: string; roleId: string; fullName?: string; districts?: string[] }): Promise<Result> {
  return act(async () => {
    const v = inviteSchema.parse(input);
    const c = await adminCtx("members.invite");
    const db = c.demo ? null : await realDb(c);
    const w = await loadWorld(c, db);
    const role = w.roles.find((r) => r.id === v.roleId);
    if (!role) return failResult("not_found", sa("roleNotFound"));
    const bad = verdict(checkRoleAssignment(c.actor, refOf(role))) ?? (role.isSystem ? null : customRolesBlocked(w.policy));
    if (bad) return bad;
    if (w.policy.maxSeats != null && w.members.filter((m) => m.isActive).length >= w.policy.maxSeats && !w.members.some((m) => m.email.toLowerCase() === v.email))
      return failResult("denied", sa("seatCap", { n: w.policy.maxSeats }));
    if (c.demo || !db) return okResult(sa("inviteDone", { email: v.email, role: role.name }), { sub: sa("demoNotice") });
    const res = (await rpc(db, "invite_member", { p_ws: c.ws, p_email: v.email, p_role: role.baseRole, p_full_name: v.fullName || null, p_districts: v.districts })) as { status?: string; user_id?: string } | null;
    if (res?.status === "member_added") {
      if (!role.isSystem && res.user_id) await setMemberRole(db, c.ws, res.user_id, role.id);
      return okResult(sa("inviteAdded", { email: v.email, role: role.name }));
    }
    // New user: the invitation row exists; the admin invite email comes from Supabase Auth (service role, server only).
    const sent = await sendInviteEmail(v.email, v.fullName);
    const sub = [sent ? sa("inviteEmailSent") : sa("inviteEmailFailed"), role.isSystem ? "" : sa("inviteCustomLater")].filter(Boolean).join(" ");
    return okResult(sa("inviteDone", { email: v.email, role: role.name }), { sub });
  });
}

async function sendInviteEmail(email: string, fullName?: string): Promise<boolean> {
  try {
    const [{ serviceDb }, { headers }] = await Promise.all([import("@/lib/db/service"), import("next/headers")]);
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const origin = host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : undefined;
    const { error } = await serviceDb().auth.admin.inviteUserByEmail(email, {
      data: fullName ? { full_name: fullName } : undefined,
      redirectTo: origin ? `${origin}/auth/callback?next=/auth/accept-invite` : undefined,
    });
    return !error;
  } catch {
    return false;
  }
}

async function targetOf(c: AdminCtx, userId: string) {
  const db = c.demo ? null : await realDb(c);
  const w = await loadWorld(c, db);
  const m = w.members.find((x) => x.userId === userId);
  const r = m ? roleOfMember(w.roles, m) : undefined;
  return { db, w, m, r };
}

export async function changeMemberRole(userId: string, roleId: string): Promise<Result> {
  return act(async () => {
    const v = changeRoleSchema.parse({ userId, roleId });
    const c = await adminCtx("members.manage");
    const { db, w, m, r } = await targetOf(c, v.userId);
    const next = w.roles.find((x) => x.id === v.roleId);
    if (!m || !r) return notFound();
    if (!next) return failResult("not_found", sa("roleNotFound"));
    const bad = verdict(checkMemberChange(c.actor, { userId: m.userId, isActive: m.isActive, role: refOf(r) }, { kind: "role", to: refOf(next) }, activeOwnerCount(w.members)))
      ?? (next.isSystem ? null : customRolesBlocked(w.policy));
    if (bad) return bad;
    if (c.demo || !db) return okResult(sa("roleChanged", { name: m.name, role: next.name }), { sub: sa("demoNotice") });
    await setMemberRole(db, c.ws, m.userId, next.id); // guard trigger re-checks; the audit trigger on memberships records old and new role
    return okResult(sa("roleChanged", { name: m.name, role: next.name }), { sub: sa("inThisWorkspaceOnly") });
  });
}

async function setActive(userId: string, active: boolean): Promise<Result> {
  return act(async () => {
    const v = memberIdSchema.parse({ userId });
    const c = await adminCtx("members.manage");
    const { db, w, m, r } = await targetOf(c, v.userId);
    if (!m || !r) return notFound();
    const bad = verdict(checkMemberChange(c.actor, { userId: m.userId, isActive: m.isActive, role: refOf(r) }, { kind: active ? "reactivate" : "suspend" }, activeOwnerCount(w.members)));
    if (bad) return bad;
    if (c.demo || !db) return okResult(sa(active ? "reactivated" : "suspended", { name: m.name }), { sub: sa("demoNotice") });
    await setMemberActive(db, c.ws, m.userId, active);
    return okResult(sa(active ? "reactivated" : "suspended", { name: m.name }), { sub: sa(active ? "inThisWorkspaceOnly" : "suspendedSub") });
  });
}
export async function suspendMember(userId: string): Promise<Result> { return setActive(userId, false); }
export async function reactivateMember(userId: string): Promise<Result> { return setActive(userId, true); }

/** Membership attributes: districts (territories) and regions. Same scope rules as a role change, never your own. */
export async function setMemberTerritory(userId: string, districts: string[], regions: string[]): Promise<Result> {
  return act(async () => {
    const v = attributesSchema.parse({ userId, districts, regions });
    const c = await adminCtx("members.manage");
    const { db, w, m, r } = await targetOf(c, v.userId);
    if (!m || !r) return notFound();
    const bad = verdict(checkMemberChange(c.actor, { userId: m.userId, isActive: m.isActive, role: refOf(r) }, { kind: "role", to: refOf(r) }, activeOwnerCount(w.members)));
    if (bad) return bad;
    const d = [...new Set(v.districts)], g = [...new Set(v.regions)];
    if (c.demo || !db) return okResult(sa("territorySaved", { name: m.name }), { sub: sa("demoNotice") });
    try {
      await setMemberAttributes(db, c.ws, m.userId, d, g);
    } catch (e) {
      if (e instanceof DbError && e.code === "unique") return failResult("invalid", sa("districtTaken"));
      throw e;
    }
    return okResult(sa("territorySaved", { name: m.name }));
  });
}

export async function saveBranding(input: { name: string; product: string; hue: number }): Promise<ActionResult> {
  const { session, active } = await requireActive();
  if (active.support) return SUPPORT;
  if (!can("branding", { role: active.role, support: active.support }) || active.tenant.primaryOwnerId !== session.uid)
    return { ok: false, message: "Only the tenant's primary owner can change branding." };
  const hue = Math.round(Number(input.hue));
  if (!Number.isFinite(hue) || hue < 0 || hue > 359) return { ok: false, message: "Hue must be 0 to 359." };
  if (!input.name.trim() || input.name.length > 40 || input.product.length > 40) return { ok: false, message: "Name and product name: 1 to 40 characters." };
  // Recomputed here from the hue (never trusted from the client).
  if (contrastChecks(hue).some((c) => c.value < c.min)) return { ok: false, message: "Text contrast is below 4.5:1. Pick another hue." };
  return { ok: true, message: `Branding saved for ${active.tenant.name}`, detail: `Hue ${hue} applies to all workspaces of ${active.tenant.name}. Demo: stored in this browser only.` };
}

export async function savePipeline(stages: { key: string; label: string; probability: number }[]): Promise<ActionResult> {
  const { active } = await requireActive();
  if (active.support?.mode === "read_only") return { ok: false, message: "Read-only support session." };
  if (!(active.role === "owner" || active.role === "sales_manager")) return { ok: false, message: "Owner or Sales Manager only." };
  if (stages.some((s) => !s.label.trim())) return { ok: false, message: "Every stage needs a name." };
  return { ok: true, message: `Pipeline saved: ${stages.length} stages`, detail: `${active.ws.name} only. ${DEMO}` };
}

export async function completeErasure(requestId: string): Promise<ActionResult> {
  const { active } = await requireActive();
  if (active.support) return SUPPORT;
  if (!can("erase", { role: active.role, support: active.support }) || !can("privacyRequests", { role: active.role, support: active.support }))
    return { ok: false, message: "Only the Owner can complete an erasure." };
  return { ok: true, message: `Erasure ${requestId} would run erase_lead()`, detail: `Lead, contacts and messages removed; audit keeps a [pii] placeholder. ${DEMO}` };
}
