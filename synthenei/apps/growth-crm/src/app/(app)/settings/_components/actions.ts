"use server";
// Settings mutations. Each one re-checks permissions server-side with the support-aware can() plus the
// row-level rules the UI also shows (manager scope, tenant primary owner). Demo: no persistence; the result
// says what would have happened. Real path: RPCs invite_member(), set_member_role(), deactivate_member(),
// update_tenant_branding(), save_pipeline_stages(), erase_lead(); RLS + has_member_role() are the guarantee.
import { requireActive } from "@/lib/auth/server";
import { can, ROLE_LABEL } from "@/lib/auth/roles";
import { MEMBERSHIPS, userById } from "@/lib/tenancy";
import type { Role } from "@/lib/data/types";
import { contrastChecks } from "./contrast";

export type ActionResult = { ok: boolean; message: string; detail?: string };
const DEMO = "Demo: nothing was saved or sent.";
const SUPPORT = { ok: false, message: "Not available in a support session." } as const;
const MANAGER_SCOPE: Role[] = ["sales_rep", "viewer"];
const ROLES: Role[] = ["owner", "sales_manager", "sales_rep", "marketing", "data", "viewer"];

async function manageCtx() {
  const { session, active } = await requireActive();
  return { session, active, ok: can("manageUsers", { role: active.role, support: active.support }) };
}
/** Owner: any role. Sales Manager: only Sales Rep and Viewer, for both the target's current and new role. */
const inScope = (actor: Role, ...roles: Role[]) => actor === "owner" || (actor === "sales_manager" && roles.every((r) => MANAGER_SCOPE.includes(r)));

export async function inviteMember(email: string, role: Role): Promise<ActionResult> {
  const { active, ok } = await manageCtx();
  if (active.support) return SUPPORT;
  if (!ok) return { ok: false, message: `Your role (${ROLE_LABEL[active.role]}) cannot invite users.` };
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return { ok: false, message: "Enter a valid email address." };
  if (!ROLES.includes(role) || !inScope(active.role, role)) return { ok: false, message: "Sales Managers can invite Sales Reps and Viewers only." };
  return { ok: true, message: `Invitation to ${clean} as ${ROLE_LABEL[role]}`, detail: `For ${active.tenant.name} · ${active.ws.name} only, expires in 7 days. ${DEMO}` };
}

export async function changeMemberRole(userId: string, role: Role): Promise<ActionResult> {
  const { session, active, ok } = await manageCtx();
  if (active.support) return SUPPORT;
  if (!ok) return { ok: false, message: "Your role cannot change roles." };
  if (userId === session.uid) return { ok: false, message: "You cannot change your own role." };
  const m = MEMBERSHIPS.find((x) => x.userId === userId && x.workspaceId === active.ws.id);
  if (!m) return { ok: false, message: "Not a member of this workspace." };
  if (!ROLES.includes(role) || !inScope(active.role, m.role, role)) return { ok: false, message: "Sales Managers manage Sales Reps and Viewers only." };
  return { ok: true, message: `${userById(userId)?.name ?? "Member"}: ${ROLE_LABEL[m.role]} to ${ROLE_LABEL[role]}`, detail: `In ${active.ws.name} only; other workspaces unchanged. ${DEMO}` };
}

export async function suspendMember(userId: string): Promise<ActionResult> {
  const { session, active, ok } = await manageCtx();
  if (active.support) return SUPPORT;
  if (!ok) return { ok: false, message: "Your role cannot suspend members." };
  if (userId === session.uid) return { ok: false, message: "You cannot suspend yourself." };
  const m = MEMBERSHIPS.find((x) => x.userId === userId && x.workspaceId === active.ws.id);
  if (!m || !inScope(active.role, m.role)) return { ok: false, message: "Sales Managers manage Sales Reps and Viewers only." };
  return { ok: true, message: `${userById(userId)?.name ?? "Member"} suspended in ${active.ws.name}`, detail: `Membership deactivated, sessions revoked, history kept. ${DEMO}` };
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
