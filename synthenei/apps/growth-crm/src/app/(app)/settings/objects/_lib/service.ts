// Custom-object administration as pure orchestration over injected deps: policy check -> key uniqueness -> insert the object type ->
// insert its primary field -> audit row -> metadata.changed event. The database trigger creates obj:<key>.read|write|delete and gives
// owner full and sales manager read+write by default; nothing here names a role. Demo sessions never reach this module.
import { failResult, okResult, type ActionResult } from "@/lib/actions/result";
import type { AuditActor, AuditInput } from "@/lib/audit/types";
import type { Tr } from "@/lib/layouts/strings";
import { fieldFromInput, fieldInputSchema, keyFromLabel, rowFromField } from "@/lib/metadata/defs";
import { deriveObjectKey, isReservedKey, labelJson, ta, type ObjectInput, type ObjectUpdate } from "./schema";
import type { AdminObject } from "./repo";

export interface ObjectDeps {
  allowed(tenantId: string): Promise<boolean>;
  list(tenantId: string): Promise<AdminObject[]>;
  getByKey(tenantId: string, key: string): Promise<AdminObject | null>;
  insert(tenantId: string, row: { key: string; label: unknown; icon: string; primaryField: string; position: number }): Promise<AdminObject>;
  insertPrimaryField(objectTypeId: string, row: Record<string, unknown>): Promise<unknown>;
  updateGuarded(id: string, rev: string, patch: Record<string, unknown>): Promise<AdminObject>;
  audit(actor: AuditActor, input: AuditInput): Promise<unknown>;
  emit(e: { type: "metadata.changed"; objectType: string; objectId: string; workspaceId: string; data: Record<string, unknown> }): Promise<unknown>;
}
export interface ObjectAdminCtx { ws: string; tenantId: string; actor: AuditActor; t: Tr; deps: ObjectDeps; log?: (m: string, e: unknown) => void }

async function auditAfter(ctx: ObjectAdminCtx, input: AuditInput): Promise<string | undefined> {
  try { await ctx.deps.audit(ctx.actor, input); return undefined; } catch (e) { ctx.log?.("audit failed", e); return ctx.t("auditFailed"); }
}
async function announce(ctx: ObjectAdminCtx, o: AdminObject, change: string): Promise<void> {
  try { await ctx.deps.emit({ type: "metadata.changed", objectType: "object_type", objectId: o.id, workspaceId: ctx.ws, data: { object: o.key, change } }); } catch (e) { ctx.log?.("metadata.changed event failed", e); }
}

export async function createObjectFlow(ctx: ObjectAdminCtx, input: ObjectInput): Promise<ActionResult<{ object: AdminObject }>> {
  if (!(await ctx.deps.allowed(ctx.tenantId))) return failResult("denied", ctx.t("policyOff"));
  const key = input.key ?? deriveObjectKey(input.one.en);
  if (isReservedKey(key)) return failResult("invalid", ctx.t("keyReserved", { key }), { issues: [{ path: "key", message: ctx.t("keyReserved", { key }) }] });
  if (await ctx.deps.getByKey(ctx.tenantId, key)) return failResult("invalid", ctx.t("keyTaken", { key }), { issues: [{ path: "key", message: ctx.t("keyTaken", { key }) }] });
  const all = await ctx.deps.list(ctx.tenantId);
  const position = all.reduce((m, o) => Math.max(m, o.position), 0) + 1;
  const primaryKey = keyFromLabel(input.primary.en);
  const created = await ctx.deps.insert(ctx.tenantId, { key, label: labelJson(input), icon: input.icon, primaryField: primaryKey, position });
  const field = fieldFromInput(fieldInputSchema.parse({
    objectKey: key, key: primaryKey, label: { en: input.primary.en, ta: ta(input.primary.ta) ?? "" }, type: "text", required: true, isSearchable: true, isFilterable: false,
  }));
  try { await ctx.deps.insertPrimaryField(created.id, { ...rowFromField(field), position: 0 }); } catch (e) {
    // The object exists without its primary field. Say so rather than pretend: the field editor can add it.
    ctx.log?.("primary field insert failed", e);
    return okResult(ctx.t("objectCreated", { label: input.one.en }), { sub: ctx.t("primaryFieldFailed", { key: primaryKey }), data: { object: created } });
  }
  const warn = await auditAfter(ctx, { action: "objects.created", summary: `Created custom object ${key}`, object: { table: "object_types", id: created.id }, detail: { key, icon: input.icon, primaryField: primaryKey } });
  await announce(ctx, created, "created");
  return okResult(ctx.t("objectCreated", { label: input.one.en }), { sub: warn, data: { object: created } });
}

export async function updateObjectFlow(ctx: ObjectAdminCtx, input: ObjectUpdate): Promise<ActionResult<{ object: AdminObject }>> {
  const cur = await ctx.deps.getByKey(ctx.tenantId, input.key);
  if (!cur || cur.kind !== "custom") return failResult("not_found", ctx.t("objectGone"));
  if (cur.rev !== input.rev) return failResult("conflict", ctx.t("conflictTitle"), { sub: ctx.t("conflictBody"), current: { rev: cur.rev } });
  const next = labelJson(input);
  const changed: string[] = [];
  if (JSON.stringify(next) !== JSON.stringify({ en: cur.label.en, ...(cur.label.ta ? { ta: cur.label.ta } : {}) })) changed.push("label");
  if (input.icon !== cur.icon) changed.push("icon");
  if (input.enabled !== cur.isEnabled) changed.push(input.enabled ? "enabled" : "disabled");
  if (!changed.length) return okResult(ctx.t("noChanges"), { data: { object: cur } });
  const updated = await ctx.deps.updateGuarded(cur.id, input.rev, { label: next, icon: input.icon, is_enabled: input.enabled });
  const action = changed.includes("enabled") ? "objects.enabled" : changed.includes("disabled") ? "objects.disabled" : "objects.updated";
  const warn = await auditAfter(ctx, { action, summary: `Changed custom object ${cur.key}: ${changed.join(", ")}`, object: { table: "object_types", id: cur.id }, detail: { key: cur.key, changed } });
  await announce(ctx, updated, changed.join(","));
  return okResult(ctx.t(changed.includes("disabled") ? "objectDisabled" : changed.includes("enabled") ? "objectEnabled" : "objectSaved", { label: input.one.en }), { sub: warn, data: { object: updated } });
}
