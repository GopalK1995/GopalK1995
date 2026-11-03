// Field-definition writes for the admin editor. Pure orchestration over injected deps so it is unit-testable:
// limit check -> guarded (versioned) write -> audit row -> metadata.changed event. Destructive changes (retire a field,
// retire options that have data) need a written reason and are audited BEFORE the write (fail closed).
// Demo is handled by the caller (settings/fields/actions.ts): nothing here runs for demo sessions.
import { DbError } from "@/lib/db/errors";
import { failResult, okResult, type ActionResult } from "@/lib/actions/result";
import type { AuditActor, AuditInput } from "@/lib/audit/types";
import { MIN_REASON } from "@/lib/audit/types";
import { diffField, fieldFromInput, reconcileChoices, reorder, rowFromField, type FieldInputParsed } from "./defs";
import type { FieldDef } from "./types";

export interface AdminDeps {
  getFieldByKey(objectTypeId: string, key: string): Promise<FieldDef | null>;
  listFields(objectTypeId: string, o?: { includeArchived?: boolean }): Promise<FieldDef[]>;
  insertField(objectTypeId: string, row: Record<string, unknown>, position: number): Promise<FieldDef>;
  updateFieldGuarded(id: string, rev: string, patch: Record<string, unknown>): Promise<FieldDef>;
  setPositions(items: { id: string; position: number }[]): Promise<void>;
  fieldLimit(tenantId: string): Promise<{ max: number | null; used: number }>;
  countWithValue(objectKey: string, key: string): Promise<number>;
  audit(actor: AuditActor, input: AuditInput): Promise<unknown>;
  emit(e: { type: "metadata.changed"; objectType: string; objectId: string; workspaceId: string; data: Record<string, unknown> }): Promise<unknown>;
}

export interface AdminCtx {
  ws: string; tenantId: string; objectKey: string; objectTypeId: string; actor: AuditActor;
  /** Translator for the `fields` namespace (vocabulary nouns already bound). */
  t: (key: string, vars?: Record<string, string | number>) => string;
  deps: AdminDeps;
  log?: (msg: string, e: unknown) => void;
}

const reasonOk = (r: string | undefined) => (r ?? "").trim().length >= MIN_REASON;
const conflict = (ctx: AdminCtx, rev: unknown): ActionResult<never> => failResult("conflict", ctx.t("conflictTitle"), { sub: ctx.t("conflictBody"), current: rev === undefined ? undefined : { rev } });

async function announce(ctx: AdminCtx, def: FieldDef, change: string, extra: Record<string, unknown> = {}): Promise<string | undefined> {
  try {
    await ctx.deps.emit({ type: "metadata.changed", objectType: "field_def", objectId: def.id, workspaceId: ctx.ws, data: { object: ctx.objectKey, field: def.key, change, ...extra } });
  } catch (e) { ctx.log?.("metadata.changed event failed", e); }
  return undefined;
}

/** Non-destructive audit, after the write. Failure is reported in `sub`, never hidden. */
async function auditAfter(ctx: AdminCtx, input: AuditInput): Promise<string | undefined> {
  try { await ctx.deps.audit(ctx.actor, input); return undefined; } catch (e) { ctx.log?.("audit failed", e); return ctx.t("auditFailed"); }
}

export async function createFieldDef(ctx: AdminCtx, input: FieldInputParsed): Promise<ActionResult<{ field: FieldDef }>> {
  const lim = await ctx.deps.fieldLimit(ctx.tenantId);
  if (lim.max !== null && lim.used >= lim.max) return failResult("invalid", ctx.t("limitReached", { max: lim.max }));
  if (await ctx.deps.getFieldByKey(ctx.objectTypeId, input.key)) return failResult("invalid", ctx.t("keyTaken", { key: input.key }), { issues: [{ path: "key", message: ctx.t("keyTaken", { key: input.key }) }] });
  const all = await ctx.deps.listFields(ctx.objectTypeId, { includeArchived: true });
  const position = all.reduce((m, f) => Math.max(m, f.position), -1) + 1;
  const created = await ctx.deps.insertField(ctx.objectTypeId, rowFromField(fieldFromInput(input)), position);
  const warn = await auditAfter(ctx, { action: "fields.created", summary: `Created custom field ${created.key} (${created.type}) on ${ctx.objectKey}`, object: { table: "field_defs", id: created.id }, detail: { object: ctx.objectKey, key: created.key, type: created.type, isPii: created.isPii, required: created.required } });
  await announce(ctx, created, "created", { type: created.type });
  return okResult(ctx.t("created", { label: created.label.en }), { sub: warn, data: { field: created } });
}

export async function updateFieldDef(ctx: AdminCtx, input: FieldInputParsed, rev: string, reason?: string): Promise<ActionResult<{ field: FieldDef }>> {
  const cur = await ctx.deps.getFieldByKey(ctx.objectTypeId, input.key);
  if (!cur) return failResult("not_found", ctx.t("fieldGone"));
  if (cur.archivedAt) return failResult("invalid", ctx.t("fieldRetired"));
  if (cur.rev && cur.rev !== rev) return conflict(ctx, cur.rev);
  const next = fieldFromInput(input);
  const hasData = async () => (await ctx.deps.countWithValue(ctx.objectKey, cur.key)) > 0;
  if (input.type !== cur.type && await hasData()) return failResult("invalid", ctx.t("typeLocked"), { issues: [{ path: "type", message: ctx.t("typeLocked") }] });

  // Options removed from the list are retired (kept, hidden), never dropped.
  let options = next.options;
  let retiredChoices: string[] = [];
  if (next.type === "select" || next.type === "multi_select") {
    const r = reconcileChoices(cur.options.choices ?? [], next.options.choices ?? []);
    options = { ...next.options, choices: r.choices };
    retiredChoices = r.retired;
  }
  const merged: FieldDef = { ...cur, ...next, options, id: cur.id, objectTypeId: cur.objectTypeId, position: cur.position, archivedAt: null };
  const changes = diffField(cur, merged);
  if (!changes.length) return okResult(ctx.t("noChanges"), { data: { field: cur } });

  // Retiring options that records still use is destructive in intent: reason first, audit before the write.
  const usedRetired = retiredChoices.length ? await hasData() : false;
  if (usedRetired) {
    if (!reasonOk(reason)) return failResult("invalid", ctx.t("reasonNeeded", { n: MIN_REASON }), { issues: [{ path: "reason", message: ctx.t("reasonNeeded", { n: MIN_REASON }) }] });
    await ctx.deps.audit(ctx.actor, { action: "config.field_options_retired", summary: `Retired options ${retiredChoices.join(", ")} of ${cur.key} on ${ctx.objectKey}`, reason, object: { table: "field_defs", id: cur.id }, detail: { object: ctx.objectKey, key: cur.key, options: retiredChoices } });
  }
  let saved: FieldDef;
  try { saved = await ctx.deps.updateFieldGuarded(cur.id, rev, { ...rowFromField({ ...next, options }) }); } catch (e) {
    if (e instanceof DbError && e.code === "conflict") return conflict(ctx, (e.current as { rev?: string } | undefined)?.rev);
    throw e;
  }
  const warn = usedRetired ? undefined : await auditAfter(ctx, { action: "fields.updated", summary: `Changed custom field ${cur.key} on ${ctx.objectKey}`, object: { table: "field_defs", id: cur.id }, detail: { object: ctx.objectKey, key: cur.key, changes: changes.map((c) => c.field) } });
  await announce(ctx, saved, "updated", { changes: changes.map((c) => c.field) });
  return okResult(ctx.t("saved", { label: saved.label.en }), { sub: warn, data: { field: saved } });
}

/** Retire = hidden from forms, tables and filters; values stay in the records. Needs a reason; audited before it happens. */
export async function retireFieldDef(ctx: AdminCtx, key: string, rev: string, reason: string): Promise<ActionResult<{ field: FieldDef; withValues: number }>> {
  if (!reasonOk(reason)) return failResult("invalid", ctx.t("reasonNeeded", { n: MIN_REASON }), { issues: [{ path: "reason", message: ctx.t("reasonNeeded", { n: MIN_REASON }) }] });
  const cur = await ctx.deps.getFieldByKey(ctx.objectTypeId, key);
  if (!cur) return failResult("not_found", ctx.t("fieldGone"));
  if (cur.archivedAt) return failResult("invalid", ctx.t("fieldRetired"));
  if (cur.rev && cur.rev !== rev) return conflict(ctx, cur.rev);
  const withValues = await ctx.deps.countWithValue(ctx.objectKey, key);
  await ctx.deps.audit(ctx.actor, { action: "config.field_retired", summary: `Retired custom field ${key} on ${ctx.objectKey}`, reason, object: { table: "field_defs", id: cur.id }, detail: { object: ctx.objectKey, key, kept_values: withValues > 0 } });
  let saved: FieldDef;
  try { saved = await ctx.deps.updateFieldGuarded(cur.id, rev, { archived_at: new Date().toISOString() }); } catch (e) {
    if (e instanceof DbError && e.code === "conflict") return conflict(ctx, (e.current as { rev?: string } | undefined)?.rev);
    throw e;
  }
  await announce(ctx, saved, "retired");
  return okResult(ctx.t(withValues > 0 ? "retiredKept" : "retired", { label: cur.label.en }), { data: { field: saved, withValues } });
}

export async function restoreFieldDef(ctx: AdminCtx, key: string, rev: string): Promise<ActionResult<{ field: FieldDef }>> {
  const cur = await ctx.deps.getFieldByKey(ctx.objectTypeId, key);
  if (!cur) return failResult("not_found", ctx.t("fieldGone"));
  if (!cur.archivedAt) return okResult(ctx.t("noChanges"), { data: { field: cur } });
  if (cur.rev && cur.rev !== rev) return conflict(ctx, cur.rev);
  let saved: FieldDef;
  try { saved = await ctx.deps.updateFieldGuarded(cur.id, rev, { archived_at: null }); } catch (e) {
    if (e instanceof DbError && e.code === "conflict") return conflict(ctx, (e.current as { rev?: string } | undefined)?.rev);
    throw e;
  }
  const warn = await auditAfter(ctx, { action: "fields.restored", summary: `Restored custom field ${key} on ${ctx.objectKey}`, object: { table: "field_defs", id: cur.id }, detail: { object: ctx.objectKey, key } });
  await announce(ctx, saved, "restored");
  return okResult(ctx.t("restored", { label: cur.label.en }), { sub: warn, data: { field: saved } });
}

export async function moveFieldDef(ctx: AdminCtx, key: string, delta: -1 | 1): Promise<ActionResult> {
  const active = (await ctx.deps.listFields(ctx.objectTypeId)).filter((f) => !f.archivedAt);
  const plan = reorder(active, key, delta);
  if (!plan.length) return okResult(ctx.t("noChanges"));
  await ctx.deps.setPositions(plan);
  const moved = active.find((f) => f.key === key);
  const warn = await auditAfter(ctx, { action: "fields.reordered", summary: `Reordered custom fields on ${ctx.objectKey}`, object: { table: "field_defs", id: moved?.id }, detail: { object: ctx.objectKey, key, delta } });
  if (moved) await announce(ctx, moved, "reordered");
  return okResult(ctx.t("moved"), { sub: warn });
}
