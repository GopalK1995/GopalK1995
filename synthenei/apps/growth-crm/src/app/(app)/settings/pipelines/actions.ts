"use server";
// Pipeline administration. Every action: zod -> assertCan("pipelines.manage") (the permission catalogue, never a role name)
// -> real workspaces: src/lib/metadata/pipelines-admin.ts (guarded writes, audit, metadata.changed); demo workspaces: the
// tenant config document through saveConfig (same validation and "stages" section authorization), kept in this browser.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { requireActive } from "@/lib/auth/server";
import { assertCan } from "@/lib/authz/load";
import { actorFromPrincipal, audit } from "@/lib/audit/record";
import { emitEvent } from "@/lib/events/emit";
import { pageCtx } from "@/lib/data/context";
import { STAGE_COLORS } from "@/lib/config/types";
import { pipelinesFromConfig, type PipelineObject, type StageInput } from "@/lib/metadata/pipelines";
import { createPipeline, renamePipeline, saveStages, setPipelineArchived, type PipeCtx, type PipeDeps } from "@/lib/metadata/pipelines-admin";
import { patchArchivePipeline, patchCreatePipeline, patchRenamePipeline, patchSaveStages, type PatchResult } from "@/lib/metadata/pipelines-config";
import * as repo from "@/lib/metadata/pipelines-repo";
import { PT } from "@/lib/metadata/pipelines-strings";
import { saveConfig } from "../_components/config-actions";

const keyRe = /^[a-z][a-z0-9_]{1,40}$/;
const objectSchema = z.enum(["lead", "deal"]);
const stageSchema = z.object({
  key: z.string().regex(keyRe).optional(), id: z.string().max(80).optional(), version: z.number().int().min(0).optional(),
  name: z.string().max(80), probability: z.number(), color: z.enum(STAGE_COLORS), outcome: z.enum(["open", "won", "lost"]),
  slaHours: z.number().nullable(), requiredFields: z.array(z.string().max(60)).max(12), archived: z.boolean(),
});
const saveSchema = z.object({ objectType: objectSchema, pipelineKey: z.string().regex(keyRe), stages: z.array(stageSchema).max(40) });
const createSchema = z.object({ name: z.string().max(80) });
const renameSchema = z.object({ key: z.string().regex(keyRe), name: z.string().max(80) });
const archiveSchema = z.object({ key: z.string().regex(keyRe), archived: z.boolean() });

const deps: PipeDeps = {
  list: (ws, t) => repo.listPipelines(ws, t),
  insertPipeline: (a) => repo.insertPipeline(a),
  updatePipeline: (ws, id, patch) => repo.updatePipeline(ws, id, patch),
  insertStage: (a) => repo.insertStage(a),
  updateStageGuarded: (ws, id, v, w, prev) => repo.updateStageGuarded(ws, id, v, w, prev),
  setStagePositions: (ws, items) => repo.setStagePositions(ws, items),
  countInStage: (t, id) => repo.countInStage(t, id),
  audit: (actor, input) => audit(actor, input),
  emit: (e) => emitEvent(e),
};

async function gate(objectType: PipelineObject) {
  const ctx = await pageCtx();
  const principal = await assertCan("pipelines.manage");
  const demo = ctx.session.demo === true;
  const tenantId = demo ? "" : await repo.tenantOfWorkspace(ctx.active.ws.uuid);
  const customKeys = demo ? [] : (await repo.listCustomFieldKeys(tenantId, objectType)).map((f) => f.key);
  const pctx: PipeCtx = { ws: ctx.active.ws.uuid, tenantId, objectType, actor: actorFromPrincipal(principal), deps, customKeys, log: (m, e) => console.error(`[pipelines] ${m}`, e) };
  return { ctx, demo, pctx };
}
type Gate = Awaited<ReturnType<typeof gate>>;

async function guarded<T>(objectType: PipelineObject, body: (g: Gate) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  const res = await runAction<T>(async () => body(await gate(objectType)));
  if (res.ok) { revalidatePath("/settings/pipelines"); revalidatePath("/pipeline"); return res; }
  const { active } = await requireActive();
  if (res.code === "denied") return { ...res, message: PT.denied, sub: active.support ? PT.deniedSupport : undefined };
  if (res.code === "error") return { ...res, message: PT.errorTitle, sub: PT.errorBody };
  return res;
}
const invalid = (e: { issues: { path: PropertyKey[]; message: string }[] }): ActionResult<never> =>
  failResult("invalid", e.issues[0]?.message ?? PT.invalidBody, { issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });

/** Demo: apply a config patch the way Settings -> Configuration does; the result carries the config store's wording. */
async function viaConfig<T>(g: Gate, r: PatchResult, data?: T): Promise<ActionResult<T>> {
  if (!r.ok) return failResult("invalid", r.message, { issues: r.issues });
  const saved = await saveConfig(g.ctx.active.tenant.id, r.patch);
  if (!saved.ok) return failResult("invalid", saved.message);
  return okResult(r.message, { sub: PT.demoNotSaved, data });
}

export async function savePipelineStages(raw: unknown): Promise<ActionResult<{ added: string[]; archived: string[]; changed: string[] }>> {
  const p = saveSchema.safeParse(raw);
  if (!p.success) return failResult("invalid", p.error.issues[0]?.message ?? PT.invalidBody);
  return guarded(p.data.objectType, async (g) => {
    const inputs = p.data.stages as StageInput[];
    if (!g.demo) return saveStages(g.pctx, p.data.pipelineKey, inputs);
    const deals = p.data.objectType === "deal" ? await g.ctx.ds.deals() : [];
    const def = pipelinesFromConfig(g.ctx.cfg, "deal").find((x) => x.isDefault)?.key;
    const inPipeline = (d: { pipeline?: string }) => (d.pipeline ?? def) === p.data.pipelineKey;
    const leads = p.data.objectType === "lead" ? await g.ctx.ds.leads() : [];
    const count = (k: string) => (p.data.objectType === "deal" ? deals.filter((d) => inPipeline(d) && d.stage === k).length : leads.filter((l) => l.stage === k).length);
    const r = patchSaveStages(g.ctx.cfg, p.data.objectType, p.data.pipelineKey, inputs, count);
    return viaConfig(g, r, { added: r.ok ? r.added : [], archived: r.ok ? r.archived : [], changed: [] });
  });
}

export async function createDealPipeline(raw: unknown): Promise<ActionResult<{ key: string }>> {
  const p = createSchema.safeParse(raw);
  if (!p.success) return invalid(p.error);
  return guarded("deal", async (g) => {
    if (!g.demo) return createPipeline(g.pctx, p.data.name);
    const r = patchCreatePipeline(g.ctx.cfg, "deal", p.data.name);
    return viaConfig(g, r, { key: r.ok ? (r as { key?: string }).key ?? "" : "" });
  });
}

export async function renameDealPipeline(raw: unknown): Promise<ActionResult> {
  const p = renameSchema.safeParse(raw);
  if (!p.success) return invalid(p.error);
  return guarded("deal", async (g) => (g.demo ? viaConfig(g, patchRenamePipeline(g.ctx.cfg, p.data.key, p.data.name)) : renamePipeline(g.pctx, p.data.key, p.data.name)));
}

export async function archiveDealPipeline(raw: unknown): Promise<ActionResult> {
  const p = archiveSchema.safeParse(raw);
  if (!p.success) return invalid(p.error);
  return guarded("deal", async (g) => {
    if (!g.demo) return setPipelineArchived(g.pctx, p.data.key, p.data.archived);
    const deals = await g.ctx.ds.deals();
    return viaConfig(g, patchArchivePipeline(g.ctx.cfg, p.data.key, p.data.archived, (k) => deals.filter((d) => d.pipeline === k).length));
  });
}
