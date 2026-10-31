// Saving custom values on a record: record-level permission, field-level edit permission, shared validation, then a
// version-guarded write (optimistic concurrency with the record's own version). Dependencies are injected for tests.
import { can, type ObjectType, type Principal } from "@/lib/authz";
import { failResult, okResult, type ActionResult } from "@/lib/actions/result";
import { DbError } from "@/lib/db/errors";
import { deniedEdits, maskCustomValues } from "./access";
import { authzTypeOf, type FieldDef } from "./types";
import { friendlyIssue, validateCustom } from "./validate";

export interface StoredRecord { id: string; version: number; ownerId: string | null; assigneeId: string | null; workspaceId: string; values: Record<string, unknown> }

export interface SaveDeps {
  getRecord(objectKey: string, id: string): Promise<StoredRecord | null>;
  /** Version-guarded write of the full custom document. Throws DbError conflict | not_found | unique | invalid. */
  writeValues(objectKey: string, id: string, expectedVersion: number, doc: Record<string, unknown>): Promise<{ version: number }>;
}

export const writePermOf = (objectKey: string): string => {
  const t: Record<string, string> = { lead: "leads.write", deal: "deals.write", account: "accounts.write", contact: "contacts.write", task: "tasks.write", campaign: "campaigns.write", conversation: "inbox.reply" };
  return t[objectKey] ?? `obj:${objectKey}.write`;
};

export interface SaveInput { objectKey: string; recordId: string; expectedVersion: number; patch: Record<string, unknown> }
export interface SaveCtx {
  principal: Principal; ws: string; defs: FieldDef[]; deps: SaveDeps; locale?: "en" | "ta";
  t: (key: string, vars?: Record<string, string | number>) => string;
}
export interface SaveOut { version: number; values: Record<string, unknown> }

export async function saveCustomValues(ctx: SaveCtx, input: SaveInput): Promise<ActionResult<SaveOut>> {
  const { principal: p, defs, t } = ctx;
  const rec = await ctx.deps.getRecord(input.objectKey, input.recordId);
  if (!rec) return failResult("not_found", t("recordGone"));
  const ref = { type: authzTypeOf(input.objectKey) as ObjectType, id: rec.id, workspaceId: ctx.ws, ownerId: rec.ownerId, assigneeId: rec.assigneeId };
  if (!can(p, writePermOf(input.objectKey), ref)) return failResult("denied", t("deniedEdit"));

  const keys = Object.keys(input.patch);
  const opts = { objectKey: input.objectKey, canWriteRecord: true };
  const blocked = deniedEdits(defs.filter((d) => !d.archivedAt), keys, p, opts);
  if (blocked.length) {
    // A key the caller may not edit, or that does not exist for them: the same answer, so hidden fields are not confirmed.
    return failResult("denied", t("deniedField"), { issues: blocked.map((path) => ({ path, message: t("deniedField") })) });
  }
  if (rec.version !== input.expectedVersion) return failResult("conflict", t("conflictTitle"), { sub: t("conflictBody"), current: { version: rec.version } });

  const merged: Record<string, unknown> = { ...rec.values };
  for (const [k, v] of Object.entries(input.patch)) if (v === null || v === undefined || v === "") delete merged[k]; else merged[k] = v;
  const { value, issues } = validateCustom(defs, merged, "update", { existing: rec.values });
  if (issues.length) {
    const by = new Map(defs.map((d) => [d.key, d]));
    const shown = issues.map((i) => ({ path: i.path, message: friendlyIssue(by.get(i.path), i, ctx.locale) }));
    return failResult("invalid", t("fixFields", { n: shown.length }), { issues: shown });
  }
  try {
    const w = await ctx.deps.writeValues(input.objectKey, rec.id, input.expectedVersion, value);
    return okResult(t("valuesSaved"), { data: { version: w.version, values: maskCustomValues(defs, value, p, opts) } });
  } catch (e) {
    if (e instanceof DbError && e.code === "conflict") {
      const v = (e.current as { version?: number } | undefined)?.version;
      return failResult("conflict", t("conflictTitle"), { sub: t("conflictBody"), current: v === undefined ? undefined : { version: v } });
    }
    if (e instanceof DbError && e.code === "unique") {
      const key = /custom field "([a-z][a-z0-9_]*)"/.exec(e.detail ?? "")?.[1];
      const label = defs.find((d) => d.key === key)?.label.en ?? t("aField");
      return failResult("invalid", t("notUnique", { label }), key ? { issues: [{ path: key, message: t("notUnique", { label }) }] } : undefined);
    }
    throw e;
  }
}
