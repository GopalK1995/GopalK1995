"use server";
// Custom-object administration. Every action: zod -> assertCan("objects.manage") (never in a read-only support session)
// -> _lib/service.ts (policy, key checks, writes, audit, metadata.changed event). Demo sessions validate and return the demo
// notice and never create a Supabase client. RLS re-checks the write (objects.manage + org policy allow_custom_objects).
import { revalidatePath } from "next/cache";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { assertCan } from "@/lib/authz/load";
import { requireActive } from "@/lib/auth/server";
import { getLocale } from "@/i18n/server";
import { emitEvent } from "@/lib/events/emit";
import { trFor, type Tr } from "@/lib/layouts/strings";
import { insertField as insertFieldRow, tenantOfWorkspace } from "@/lib/metadata/repo";
import * as repo from "./_lib/repo";
import { objectInputSchema, objectUpdateSchema } from "./_lib/schema";
import { createObjectFlow, updateObjectFlow, type ObjectAdminCtx, type ObjectDeps } from "./_lib/service";

const deps: ObjectDeps = {
  allowed: (t) => repo.customObjectsAllowed(t),
  list: (t) => repo.listCustomObjects(t),
  getByKey: (t, k) => repo.getCustomObject(t, k),
  insert: (t, r) => repo.insertObject(t, r),
  insertPrimaryField: (id, row) => insertFieldRow(id, row, 0),
  updateGuarded: (id, rev, patch) => repo.updateObjectGuarded(id, rev, patch),
  audit: (a, i) => audit(a, i),
  emit: (e) => emitEvent(e),
};

async function gate() {
  const { session, active } = await requireActive();
  const principal = await assertCan("objects.manage");
  const locale = (await getLocale()) === "ta" ? "ta" : "en";
  const t: Tr = trFor(locale);
  const demo = session.demo === true;
  const tenantId = demo ? "" : await tenantOfWorkspace(active.ws.uuid);
  const ctx: ObjectAdminCtx = { ws: active.ws.uuid, tenantId, actor: actorFromPrincipal(principal), t, deps, log: (m, e) => console.error(`[objects] ${m}`, e) };
  return { ctx, demo, t, support: !!active.support };
}

async function guarded<T>(body: (g: Awaited<ReturnType<typeof gate>>) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const res = await runAction<T>(async () => body(await gate()));
  if (res.ok) { revalidatePath("/settings/objects"); revalidatePath("/", "layout"); return res; }
  const { active } = await requireActive();
  const t = trFor((await getLocale()) === "ta" ? "ta" : "en");
  if (res.code === "denied") return { ...res, message: res.message.startsWith("errors.") ? t("objDeniedTitle") : res.message, sub: active.support ? t("objDeniedSupport") : t("objDeniedBody") };
  if (res.code === "error") return { ...res, message: t("errorTitle"), sub: t("errorBody") };
  if (res.code === "not_found") return { ...res, message: t("objectGone") };
  if (res.code === "conflict") return { ...res, message: t("conflictTitle"), sub: t("conflictBody") };
  return res;
}

const bad = (t: Tr, e: { issues: { path: PropertyKey[]; message: string }[] }): ActionResult<never> =>
  failResult("invalid", e.issues[0]?.message ?? t("invalidBody"), { issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });

export async function createObject(raw: unknown): Promise<ActionResult<{ object: repo.AdminObject }>> {
  const p = objectInputSchema.safeParse(raw);
  return guarded(async (g) => {
    if (g.support) return failResult("denied", g.t("objDeniedSupport"));
    if (!p.success) return bad(g.t, p.error);
    if (g.demo) return okResult(g.t("objectCreated", { label: p.data.one.en }), { sub: g.t("demoNotSaved"), data: undefined });
    return createObjectFlow(g.ctx, p.data);
  });
}

export async function updateObject(raw: unknown): Promise<ActionResult<{ object: repo.AdminObject }>> {
  const p = objectUpdateSchema.safeParse(raw);
  return guarded(async (g) => {
    if (g.support) return failResult("denied", g.t("objDeniedSupport"));
    if (!p.success) return bad(g.t, p.error);
    if (g.demo) return okResult(g.t("objectSaved", { label: p.data.one.en }), { sub: g.t("demoNotSaved"), data: undefined });
    return updateObjectFlow(g.ctx, p.data);
  });
}
