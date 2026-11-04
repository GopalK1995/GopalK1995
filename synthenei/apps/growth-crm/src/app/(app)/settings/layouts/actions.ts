"use server";
// Layout administration. Every action: zod -> assertCan("layouts.manage") (never in a read-only support session) -> _lib/service.ts
// (spec validation, role check, version-guarded write, audit, metadata.changed event). Demo sessions validate and return the demo
// notice and never create a Supabase client. RLS re-checks the write (layouts.manage at org or workspace level).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { assertCan } from "@/lib/authz/load";
import { requireActive } from "@/lib/auth/server";
import { DbError } from "@/lib/db/errors";
import { getLocale } from "@/i18n/server";
import { emitEvent } from "@/lib/events/emit";
import { deleteLayout, listRoles, saveLayout } from "@/lib/layouts/repo";
import { validateSpec } from "@/lib/layouts/spec";
import { trFor, type Tr } from "@/lib/layouts/strings";
import { getObjectMeta } from "@/lib/metadata/meta";
import { tenantOfWorkspace } from "@/lib/metadata/repo";
import { FIELD_KEY_RE } from "@/lib/metadata/types";
import { demoFields, demoObject, DEMO_OBJECT_KEY } from "../../o/_lib/demo";
import { deleteLayoutFlow, saveLayoutFlow, type LayoutCtx, type LayoutDeps } from "./_lib/service";

const deps: LayoutDeps = {
  roles: (t) => listRoles(t),
  save: (t, spec, v, by) => saveLayout(t, spec, v, by),
  remove: (t, v) => deleteLayout(t, v),
  audit: (a, i) => audit(a, i),
  emit: (e) => emitEvent(e),
};

const base = {
  objectKey: z.string().regex(FIELD_KEY_RE), kind: z.enum(["detail", "list"]), scope: z.enum(["org", "workspace"]),
  roleId: z.string().min(1).max(64).nullable(), version: z.number().int().min(0),
};
const saveSchema = z.object({ ...base, spec: z.unknown() });
const deleteSchema = z.object({ ...base });

async function gate(objectKey: string) {
  const { session, active } = await requireActive();
  const principal = await assertCan("layouts.manage");
  const locale = (await getLocale()) === "ta" ? "ta" : "en";
  const t: Tr = trFor(locale);
  const demo = session.demo === true;
  let objectTypeId: string, fields, primaryKey: string;
  if (demo) {
    if (objectKey !== DEMO_OBJECT_KEY) throw new DbError("not_found", "not_found");
    const o = demoObject(); objectTypeId = o.id; fields = demoFields(); primaryKey = o.primaryField;
  } else {
    const meta = await getObjectMeta(active.ws.uuid, objectKey);
    if (meta.object.kind !== "custom") throw new DbError("not_found", "not_found");
    objectTypeId = meta.object.id; fields = meta.fields; primaryKey = meta.object.primaryField;
  }
  const tenantId = demo ? "" : await tenantOfWorkspace(active.ws.uuid);
  const ctx: LayoutCtx = { ws: active.ws.uuid, tenantId, uid: session.uid, actor: actorFromPrincipal(principal), t, deps, objectKey, objectTypeId, fields, primaryKey, log: (m, e) => console.error(`[layouts] ${m}`, e) };
  return { ctx, demo, t, support: !!active.support };
}

async function guarded<T>(objectKey: string, body: (g: Awaited<ReturnType<typeof gate>>) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const res = await runAction<T>(async () => body(await gate(objectKey)));
  if (res.ok) { revalidatePath("/settings/layouts"); revalidatePath(`/o/${objectKey}`, "layout"); return res; }
  const { active } = await requireActive();
  const t = trFor((await getLocale()) === "ta" ? "ta" : "en");
  if (res.code === "denied") return { ...res, message: t("layoutsDeniedTitle"), sub: active.support ? t("layoutsDeniedSupport") : t("layoutsDeniedBody") };
  if (res.code === "error") return { ...res, message: t("errorTitle"), sub: t("errorBody") };
  if (res.code === "not_found") return { ...res, message: t("layoutGone") };
  if (res.code === "conflict") return { ...res, message: t("conflictTitle"), sub: t("conflictBody") };
  return res;
}

export async function saveLayoutAction(raw: unknown): Promise<ActionResult<{ version: number }>> {
  const p = saveSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !FIELD_KEY_RE.test(objectKey)) return failResult("invalid", trFor("en")("invalidBody"));
  return guarded(objectKey, async (g) => {
    if (g.support) return failResult("denied", g.t("layoutsDeniedSupport"));
    if (!p.success) return failResult("invalid", g.t("invalidBody"), { issues: p.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });
    if (g.demo) {
      const issues = validateSpec(p.data.kind, p.data.spec, g.ctx.fields, g.ctx.primaryKey);
      if (issues.length) return failResult("invalid", g.t("layoutInvalid", { n: issues.length }), { issues });
      return okResult(g.t("layoutSaved"), { sub: g.t("demoNotSaved"), data: { version: p.data.version } });
    }
    return saveLayoutFlow(g.ctx, p.data);
  });
}

export async function resetLayoutAction(raw: unknown): Promise<ActionResult> {
  const p = deleteSchema.safeParse(raw);
  const objectKey = (raw as { objectKey?: string } | null)?.objectKey;
  if (typeof objectKey !== "string" || !FIELD_KEY_RE.test(objectKey)) return failResult("invalid", trFor("en")("invalidBody"));
  return guarded(objectKey, async (g) => {
    if (g.support) return failResult("denied", g.t("layoutsDeniedSupport"));
    if (!p.success) return failResult("invalid", g.t("invalidBody"));
    if (g.demo) return okResult(g.t("layoutReset"), { sub: g.t("demoNotSaved") });
    return deleteLayoutFlow(g.ctx, p.data);
  });
}
