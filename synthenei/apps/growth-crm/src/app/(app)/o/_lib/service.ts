// Record writes for custom objects, as pure orchestration over injected deps (unit-testable, no Next or Supabase imports):
// validate against field_defs (same validator and messages as the DB trigger) -> version-guarded write -> audit row.
// The primary field's value is mirrored into records.title on every write path here. The DB has no audit trigger on
// `records` yet (see docs/migrations-backlog.md, T033 needs), so the audit rows are written explicitly. Audit rows carry
// ids and field keys only, never values. Demo sessions are handled by the caller and never reach this module.
import { failResult, okResult, type ActionResult } from "@/lib/actions/result";
import type { AuditActor, AuditInput } from "@/lib/audit/types";
import type { Tr } from "@/lib/layouts/strings";
import { checkValue, coerceValue, friendlyIssue, validateCustom } from "@/lib/metadata/validate";
import type { FieldDef } from "@/lib/metadata/types";
import { displayTitle } from "./query";
import type { ObjectRecord } from "./types";

export interface RecordDeps {
  insert(row: { workspaceId: string; objectTypeId: string; title: string; data: Record<string, unknown>; ownerId: string | null }): Promise<ObjectRecord>;
  get(id: string): Promise<ObjectRecord | null>;
  update(id: string, expectedVersion: number, patch: { title?: string; data?: Record<string, unknown>; deletedAt?: string | null }): Promise<{ version: number }>;
  audit(actor: AuditActor, input: AuditInput): Promise<unknown>;
}
export interface RecordCtx {
  ws: string; objectKey: string; objectTypeId: string; fields: FieldDef[]; primaryKey: string; actor: AuditActor; ownerId: string | null;
  locale: "en" | "ta"; t: Tr; deps: RecordDeps; log?: (msg: string, e: unknown) => void;
}

const MAX_TITLE = 300;
const titleOf = (v: unknown): string => (typeof v === "string" ? v.trim().slice(0, MAX_TITLE) : v === null || v === undefined ? "" : String(v).trim().slice(0, MAX_TITLE));

async function auditAfter(ctx: RecordCtx, input: AuditInput): Promise<string | undefined> {
  try { await ctx.deps.audit(ctx.actor, input); return undefined; } catch (e) { ctx.log?.("audit failed", e); return ctx.t("auditFailed"); }
}

function issuesOf(ctx: RecordCtx, raw: { path: string; message: string }[]) {
  return raw.map((i) => ({ path: i.path, message: friendlyIssue(ctx.fields.find((f) => f.key === i.path), i, ctx.locale) }));
}

export async function createRecordFlow(ctx: RecordCtx, values: Record<string, unknown>): Promise<ActionResult<{ id: string; version: number }>> {
  const v = validateCustom(ctx.fields, values, "create");
  const issues = issuesOf(ctx, v.issues);
  const title = titleOf(v.value[ctx.primaryKey]);
  if (!title && !issues.some((i) => i.path === ctx.primaryKey)) issues.push({ path: ctx.primaryKey, message: ctx.t("titleRequired") });
  if (issues.length) return failResult("invalid", ctx.t("fixFields", { n: issues.length }), { issues });
  const rec = await ctx.deps.insert({ workspaceId: ctx.ws, objectTypeId: ctx.objectTypeId, title, data: v.value, ownerId: ctx.ownerId });
  const warn = await auditAfter(ctx, { action: "records.created", summary: `Created a ${ctx.objectKey} record`, object: { table: "records", id: rec.id }, detail: { object: ctx.objectKey, keys: Object.keys(v.value) } });
  return okResult(ctx.t("recordCreated", { title }), { sub: warn, data: { id: rec.id, version: rec.version } });
}

export async function renameRecordFlow(ctx: RecordCtx, id: string, expectedVersion: number, rawTitle: string): Promise<ActionResult<{ version: number; title: string }>> {
  const cur = await ctx.deps.get(id);
  if (!cur) return failResult("not_found", ctx.t("recordGone"));
  if (cur.version !== expectedVersion) return failResult("conflict", ctx.t("conflictTitle"), { sub: ctx.t("conflictBody"), current: { version: cur.version } });
  const def = ctx.fields.find((f) => f.key === ctx.primaryKey);
  const title = titleOf(rawTitle);
  const val = def ? coerceValue(def, title) : title;
  const err = def ? checkValue(def, val) : null;
  if (!title || err) {
    const message = !title ? ctx.t("titleRequired") : friendlyIssue(def, { path: ctx.primaryKey, message: `custom field "${ctx.primaryKey}" ${err}` }, ctx.locale);
    return failResult("invalid", message, { issues: [{ path: ctx.primaryKey, message }] });
  }
  if (displayTitle(cur, ctx.primaryKey) === title && cur.title === title) return okResult(ctx.t("noChanges"), { data: { version: cur.version, title } });
  const upd = await ctx.deps.update(id, expectedVersion, { title: String(val), data: { ...cur.data, [ctx.primaryKey]: val } });
  const warn = await auditAfter(ctx, { action: "records.updated", summary: `Renamed a ${ctx.objectKey} record`, object: { table: "records", id }, detail: { object: ctx.objectKey, changed: [ctx.primaryKey] } });
  return okResult(ctx.t("recordRenamed"), { sub: warn, data: { version: upd.version, title: String(val) } });
}

export async function deleteRecordFlow(ctx: RecordCtx, id: string, expectedVersion: number, now: Date = new Date()): Promise<ActionResult> {
  const cur = await ctx.deps.get(id);
  if (!cur) return failResult("not_found", ctx.t("recordGone"));
  if (cur.version !== expectedVersion) return failResult("conflict", ctx.t("conflictTitle"), { sub: ctx.t("conflictBody"), current: { version: cur.version } });
  await ctx.deps.update(id, expectedVersion, { deletedAt: now.toISOString() });
  const warn = await auditAfter(ctx, { action: "records.deleted", summary: `Deleted a ${ctx.objectKey} record`, object: { table: "records", id }, detail: { object: ctx.objectKey } });
  return okResult(ctx.t("recordDeleted"), { sub: warn });
}
