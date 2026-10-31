"use server";
// Custom field administration. Every action: zod -> assertCan("fields.manage") (never in a read-only support session)
// -> src/lib/metadata/admin.ts (limit check, guarded write, audit, metadata.changed event). Demo sessions validate and
// return what would have happened, and never create a Supabase client. Writes are re-checked by RLS (fields.manage).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { requireActive } from "@/lib/auth/server";
import { assertCan } from "@/lib/authz/load";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { emitEvent } from "@/lib/events/emit";
import { getLocale } from "@/i18n/server";
import { vocabFor } from "@/lib/vertical";
import { createFieldDef, moveFieldDef, restoreFieldDef, retireFieldDef, updateFieldDef, type AdminCtx, type AdminDeps } from "@/lib/metadata/admin";
import { fieldInputSchema } from "@/lib/metadata/defs";
import { getObjectMeta } from "@/lib/metadata/meta";
import { objectNoun } from "@/lib/metadata/labels";
import * as repo from "@/lib/metadata/repo";
import { ft } from "@/lib/metadata/strings";
import type { FieldDef } from "@/lib/metadata/types";

const keyRe = /^[a-z][a-z0-9_]{1,40}$/;
const target = z.object({ objectKey: z.string().regex(keyRe), key: z.string().regex(keyRe) });
const updateSchema = z.object({ input: fieldInputSchema, rev: z.string().min(1).max(64), reason: z.string().max(500).optional() });
const retireSchema = target.extend({ rev: z.string().min(1).max(64), reason: z.string().max(500) });
const restoreSchema = target.extend({ rev: z.string().min(1).max(64) });
const moveSchema = target.extend({ delta: z.union([z.literal(-1), z.literal(1)]) });

const deps: AdminDeps = {
  getFieldByKey: (o, k) => repo.getFieldByKey(o, k),
  listFields: (o, opts) => repo.listFields(o, opts),
  insertField: (o, row, pos) => repo.insertField(o, row, pos),
  updateFieldGuarded: (id, rev, patch) => repo.updateFieldGuarded(id, rev, patch),
  setPositions: (items) => repo.setPositions(items),
  fieldLimit: (t) => repo.fieldLimit(t),
  countWithValue: (o, k) => repo.countWithValue(o, k),
  audit: (actor, input) => audit(actor, input),
  emit: (e) => emitEvent(e),
};

async function gate(objectKey: string) {
  const { session, active } = await requireActive();
  const principal = await assertCan("fields.manage");
  const locale = (await getLocale()) === "ta" ? "ta" : "en";
  const meta = await getObjectMeta(active.ws.uuid, objectKey);
  const noun = objectNoun(vocabFor(active.tenant), objectKey, meta.object);
  const t = (k: string, v: Record<string, string | number> = {}) => ft(k, { noun: noun.one, nouns: noun.many, ...v }, locale);
  const demo = session.demo === true;
  const tenantId = demo ? "" : await repo.tenantOfWorkspace(active.ws.uuid);
  const ctx: AdminCtx = {
    ws: active.ws.uuid, tenantId, objectKey, objectTypeId: meta.object.id, actor: actorFromPrincipal(principal), t, deps,
    log: (m, e) => console.error(`[fields] ${m}`, e),
  };
  return { ctx, demo, t, meta };
}

function invalid(t: (k: string) => string, e: { issues: { path: PropertyKey[]; message: string }[] }): ActionResult<never> {
  return failResult("invalid", e.issues[0]?.message ?? t("invalidBody"), { issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });
}

/** Maps authz and db failures to this namespace's wording; conflicts carry only the new token, never the row. */
async function guarded<T>(objectKey: string, body: (g: Awaited<ReturnType<typeof gate>>) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const res = await runAction<T>(async () => body(await gate(objectKey)));
  if (res.ok) { revalidatePath("/settings/fields"); return res; }
  const { active } = await requireActive();
  const locale = (await getLocale()) === "ta" ? "ta" : "en";
  if (res.code === "denied") return { ...res, message: ft("deniedTitle", {}, locale), sub: active.support ? ft("deniedSupport", {}, locale) : ft("deniedBody", {}, locale) };
  if (res.code === "error") return { ...res, message: ft("errorTitle", {}, locale), sub: ft("errorBody", {}, locale) };
  if (res.code === "not_found") return { ...res, message: ft("fieldGone", {}, locale) };
  return res;
}

export async function createField(raw: unknown): Promise<ActionResult<{ field: FieldDef }>> {
  const p = fieldInputSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !keyRe.test(objectKey)) return failResult("invalid", ft("invalidBody"));
  return guarded(objectKey, async (g) => {
    if (!p.success) return invalid(g.t, p.error);
    if (g.demo) return okResult(g.t("created", { label: p.data.label.en }), { sub: g.t("demoNotSaved") });
    return createFieldDef(g.ctx, p.data);
  });
}

export async function updateField(raw: unknown): Promise<ActionResult<{ field: FieldDef }>> {
  const p = updateSchema.safeParse(raw);
  const objectKey = (raw as { input?: { objectKey?: string } } | null)?.input?.objectKey;
  if (typeof objectKey !== "string" || !keyRe.test(objectKey)) return failResult("invalid", ft("invalidBody"));
  return guarded(objectKey, async (g) => {
    if (!p.success) return invalid(g.t, p.error);
    if (g.demo) return okResult(g.t("saved", { label: p.data.input.label.en }), { sub: g.t("demoNotSaved") });
    return updateFieldDef(g.ctx, p.data.input, p.data.rev, p.data.reason);
  });
}

export async function retireField(raw: unknown): Promise<ActionResult<{ field: FieldDef; withValues: number }>> {
  const p = retireSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !keyRe.test(objectKey)) return failResult("invalid", ft("invalidBody"));
  return guarded(objectKey, async (g) => {
    if (!p.success) return invalid(g.t, p.error);
    if (g.demo) return okResult(g.t("retired", { label: p.data.key }), { sub: g.t("demoNotSaved") });
    return retireFieldDef(g.ctx, p.data.key, p.data.rev, p.data.reason);
  });
}

export async function restoreField(raw: unknown): Promise<ActionResult<{ field: FieldDef }>> {
  const p = restoreSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !keyRe.test(objectKey)) return failResult("invalid", ft("invalidBody"));
  return guarded(objectKey, async (g) => {
    if (!p.success) return invalid(g.t, p.error);
    if (g.demo) return okResult(g.t("restored", { label: p.data.key }), { sub: g.t("demoNotSaved") });
    return restoreFieldDef(g.ctx, p.data.key, p.data.rev);
  });
}

export async function moveField(raw: unknown): Promise<ActionResult> {
  const p = moveSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !keyRe.test(objectKey)) return failResult("invalid", ft("invalidBody"));
  return guarded(objectKey, async (g) => {
    if (!p.success) return invalid(g.t, p.error);
    if (g.demo) return okResult(g.t("moved"), { sub: g.t("demoNotSaved") });
    return moveFieldDef(g.ctx, p.data.key, p.data.delta);
  });
}
