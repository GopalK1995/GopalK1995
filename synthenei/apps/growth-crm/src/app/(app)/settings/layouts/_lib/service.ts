// Layout administration as pure orchestration over injected deps: validate the spec against the live field definitions -> check the target
// role belongs to the tenant -> version-guarded write -> audit row -> metadata.changed event. Demo sessions never reach this module.
// A layout is one of: org-wide or this workspace, for everyone or for one role, per kind (detail, list).
import { failResult, okResult, type ActionResult } from "@/lib/actions/result";
import type { AuditActor, AuditInput } from "@/lib/audit/types";
import type { LayoutRow } from "@/lib/layouts/resolve";
import type { LayoutTarget, RoleRef } from "@/lib/layouts/repo";
import { validateSpec, type LayoutKind } from "@/lib/layouts/spec";
import type { Tr } from "@/lib/layouts/strings";
import type { FieldDef } from "@/lib/metadata/types";

export type LayoutScopeInput = "org" | "workspace";
export interface LayoutDeps {
  roles(tenantId: string): Promise<RoleRef[]>;
  save(t: LayoutTarget, spec: unknown, expectedVersion: number, by: string | null): Promise<LayoutRow>;
  remove(t: LayoutTarget, expectedVersion: number): Promise<string>;
  audit(actor: AuditActor, input: AuditInput): Promise<unknown>;
  emit(e: { type: "metadata.changed"; objectType: string; objectId: string; workspaceId: string; data: Record<string, unknown> }): Promise<unknown>;
}
export interface LayoutCtx {
  ws: string; tenantId: string; uid: string; actor: AuditActor; t: Tr; deps: LayoutDeps; objectKey: string; objectTypeId: string; fields: FieldDef[]; primaryKey: string;
  log?: (m: string, e: unknown) => void;
}
export interface LayoutInput { kind: LayoutKind; scope: LayoutScopeInput; roleId: string | null; spec: unknown; version: number }

export const targetOf = (ctx: Pick<LayoutCtx, "ws" | "objectTypeId">, i: Pick<LayoutInput, "kind" | "scope" | "roleId">): LayoutTarget =>
  ({ objectTypeId: ctx.objectTypeId, kind: i.kind, workspaceId: i.scope === "workspace" ? ctx.ws : null, roleId: i.roleId });

async function roleOk(ctx: LayoutCtx, roleId: string | null): Promise<boolean> {
  if (!roleId) return true;
  return (await ctx.deps.roles(ctx.tenantId)).some((r) => r.id === roleId);
}
async function auditAfter(ctx: LayoutCtx, input: AuditInput): Promise<string | undefined> {
  try { await ctx.deps.audit(ctx.actor, input); return undefined; } catch (e) { ctx.log?.("audit failed", e); return ctx.t("auditFailed"); }
}
async function announce(ctx: LayoutCtx, id: string, change: string, i: LayoutInput): Promise<void> {
  try { await ctx.deps.emit({ type: "metadata.changed", objectType: "layout", objectId: id, workspaceId: ctx.ws, data: { object: ctx.objectKey, kind: i.kind, scope: i.scope, change } }); } catch (e) { ctx.log?.("metadata.changed event failed", e); }
}

export async function saveLayoutFlow(ctx: LayoutCtx, i: LayoutInput): Promise<ActionResult<{ version: number }>> {
  const issues = validateSpec(i.kind, i.spec, ctx.fields, ctx.primaryKey);
  if (issues.length) return failResult("invalid", ctx.t("layoutInvalid", { n: issues.length }), { issues: issues.map((x) => ({ path: x.path, message: x.message })) });
  if (!(await roleOk(ctx, i.roleId))) return failResult("invalid", ctx.t("layoutRoleGone"), { issues: [{ path: "roleId", message: ctx.t("layoutRoleGone") }] });
  const row = await ctx.deps.save(targetOf(ctx, i), i.spec, i.version, ctx.uid);
  const warn = await auditAfter(ctx, { action: "layouts.saved", summary: `Saved ${i.scope} ${i.kind} layout for ${ctx.objectKey}${i.roleId ? " (role specific)" : ""}`, object: { table: "layouts", id: row.id }, detail: { object: ctx.objectKey, kind: i.kind, scope: i.scope, roleId: i.roleId, version: row.version } });
  await announce(ctx, row.id, "saved", i);
  return okResult(ctx.t("layoutSaved"), { sub: warn, data: { version: row.version } });
}

export async function deleteLayoutFlow(ctx: LayoutCtx, i: Omit<LayoutInput, "spec">): Promise<ActionResult> {
  const id = await ctx.deps.remove(targetOf(ctx, i), i.version);
  const warn = await auditAfter(ctx, { action: "layouts.deleted", summary: `Removed ${i.scope} ${i.kind} layout override for ${ctx.objectKey}`, object: { table: "layouts", id }, detail: { object: ctx.objectKey, kind: i.kind, scope: i.scope, roleId: i.roleId } });
  await announce(ctx, id, "deleted", { ...i, spec: null });
  return okResult(ctx.t("layoutReset"), { sub: warn });
}
