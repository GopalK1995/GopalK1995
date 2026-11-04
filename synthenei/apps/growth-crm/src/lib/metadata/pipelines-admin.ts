// Pipeline and stage writes for real workspaces. Pure orchestration over injected deps so it is unit-testable:
// validate -> guarded (versioned) stage writes -> audit row -> metadata.changed event. Nothing is ever deleted:
// "remove" is archive (hidden from boards and pickers, kept so records and history still resolve), refused while
// records still sit in the stage. Demo sessions never reach this module (settings/pipelines/actions.ts).
import { DbError } from "@/lib/db/errors";
import { failResult, okResult, type ActionResult } from "@/lib/actions/result";
import type { AuditActor, AuditInput } from "@/lib/audit/types";
import { MAX_EXTRA_PIPELINES, PIPELINE_KEY_RE } from "@/lib/config/types";
import { PT } from "./pipelines-strings";
import { keyFromName, validateStageInputs, type Pipeline, type PipelineObject, type Stage, type StageInput } from "./pipelines";
import type { StageWrite } from "./pipelines-repo";
import type { I18nLabel } from "./types";

export interface PipeDeps {
  list(ws: string, objectType: PipelineObject): Promise<Pipeline[]>;
  insertPipeline(a: { ws: string; tenantId: string; objectType: PipelineObject; key: string; name: I18nLabel; position: number }): Promise<string>;
  updatePipeline(ws: string, id: string, patch: { name?: I18nLabel; archivedAt?: string | null }): Promise<void>;
  insertStage(a: { ws: string; tenantId: string; pipelineId: string; key: string; write: StageWrite }): Promise<Stage>;
  updateStageGuarded(ws: string, id: string, version: number, w: StageWrite, prevArchived: boolean): Promise<Stage>;
  setStagePositions(ws: string, items: { id: string; position: number }[]): Promise<void>;
  countInStage(objectType: PipelineObject, stageId: string): Promise<number>;
  audit(actor: AuditActor, input: AuditInput): Promise<unknown>;
  emit(e: { type: "metadata.changed"; objectType: string; objectId: string; workspaceId: string; data: Record<string, unknown> }): Promise<unknown>;
}
export interface PipeCtx { ws: string; tenantId: string; objectType: PipelineObject; actor: AuditActor; deps: PipeDeps; customKeys?: string[]; log?: (msg: string, e: unknown) => void }

const stale = (): ActionResult<never> => failResult("conflict", PT.conflictTitle, { sub: PT.conflictBody });
const bad = (message: string, path = "stages"): ActionResult<never> => failResult("invalid", message, { issues: [{ path, message }] });

async function trail(ctx: PipeCtx, p: Pipeline, change: string, input: AuditInput, detail: Record<string, unknown> = {}): Promise<string | undefined> {
  let warn: string | undefined;
  try { await ctx.deps.audit(ctx.actor, input); } catch (e) { ctx.log?.("audit failed", e); warn = PT.auditFailed; }
  try { await ctx.deps.emit({ type: "metadata.changed", objectType: "pipeline", objectId: p.id, workspaceId: ctx.ws, data: { object: ctx.objectType, pipeline: p.key, change, ...detail } }); } catch (e) { ctx.log?.("metadata.changed event failed", e); }
  return warn;
}
const findPipeline = async (ctx: PipeCtx, key: string) => (await ctx.deps.list(ctx.ws, ctx.objectType)).find((p) => p.key === key) ?? null;
const writeOf = (s: StageInput, name: I18nLabel, position: number): StageWrite => ({ name, position, probability: s.probability, color: s.color, outcome: s.outcome, slaHours: s.slaHours, requiredFields: s.requiredFields, archived: s.archived });

/** A new deal pipeline starts with one open stage plus Won and Lost, so it is usable at once. */
export async function createPipeline(ctx: PipeCtx, name: string): Promise<ActionResult<{ key: string }>> {
  const nm = name.trim();
  if (!nm) return bad(PT.pipelineNeedsName, "name");
  if (nm.length > 40) return bad(PT.pipelineNameLong, "name");
  if (ctx.objectType === "lead") return failResult("invalid", PT.leadSingle);
  const all = await ctx.deps.list(ctx.ws, ctx.objectType);
  if (all.filter((p) => !p.isDefault && !p.archived).length >= MAX_EXTRA_PIPELINES) return bad(PT.pipelineLimit(MAX_EXTRA_PIPELINES));
  if (all.some((p) => !p.archived && p.name.en.toLowerCase() === nm.toLowerCase())) return bad(PT.pipelineNameTaken, "name");
  const key = keyFromName(nm, all.map((p) => p.key), "pipeline");
  if (!PIPELINE_KEY_RE.test(key)) return bad(PT.pipelineNameBad, "name");
  const id = await ctx.deps.insertPipeline({ ws: ctx.ws, tenantId: ctx.tenantId, objectType: ctx.objectType, key, name: { en: nm }, position: Math.max(0, ...all.map((p) => p.position)) + 1 });
  const seed: [string, string, number, StageWrite["color"], StageWrite["outcome"]][] = [["New", "new", 10, "neutral", "open"], ["Won", "won", 100, "success", "won"], ["Lost", "lost", 0, "danger", "lost"]];
  for (const [i, [label, k, prob, color, outcome]] of seed.entries()) {
    await ctx.deps.insertStage({ ws: ctx.ws, tenantId: ctx.tenantId, pipelineId: id, key: k, write: { name: { en: label }, position: i + 1, probability: prob, color, outcome, slaHours: null, requiredFields: [], archived: false } });
  }
  const warn = await trail(ctx, { id, key, objectType: ctx.objectType, name: { en: nm }, isDefault: false, position: 0, archived: false, stages: [] }, "created",
    { action: "pipelines.created", summary: `Created ${ctx.objectType} pipeline ${nm}`, object: { table: "pipelines", id }, detail: { object: ctx.objectType, key } });
  return okResult(PT.pipelineCreated(nm), { sub: warn, data: { key } });
}

export async function renamePipeline(ctx: PipeCtx, key: string, name: string): Promise<ActionResult> {
  const nm = name.trim();
  if (!nm) return bad(PT.pipelineNeedsName, "name");
  if (nm.length > 40) return bad(PT.pipelineNameLong, "name");
  const all = await ctx.deps.list(ctx.ws, ctx.objectType);
  const p = all.find((x) => x.key === key);
  if (!p) return failResult("not_found", PT.pipelineGone);
  if (all.some((x) => x.id !== p.id && !x.archived && x.name.en.toLowerCase() === nm.toLowerCase())) return bad(PT.pipelineNameTaken, "name");
  await ctx.deps.updatePipeline(ctx.ws, p.id, { name: { ...p.name, en: nm } });
  const warn = await trail(ctx, p, "renamed", { action: "pipelines.renamed", summary: `Renamed ${ctx.objectType} pipeline ${p.name.en} to ${nm}`, object: { table: "pipelines", id: p.id }, detail: { object: ctx.objectType, key } });
  return okResult(PT.pipelineRenamed(nm), { sub: warn });
}

export async function setPipelineArchived(ctx: PipeCtx, key: string, archived: boolean): Promise<ActionResult> {
  const p = await findPipeline(ctx, key);
  if (!p) return failResult("not_found", PT.pipelineGone);
  if (p.isDefault) return bad(PT.defaultKeeps);
  if (archived) {
    for (const s of p.stages.filter((x) => !x.archived && x.outcome === "open")) {
      if ((await ctx.deps.countInStage(ctx.objectType, s.id)) > 0) return bad(PT.pipelineInUse(p.name.en));
    }
  }
  await ctx.deps.updatePipeline(ctx.ws, p.id, { archivedAt: archived ? new Date().toISOString() : null });
  const warn = await trail(ctx, p, archived ? "archived" : "restored", { action: archived ? "pipelines.archived" : "pipelines.restored", summary: `${archived ? "Archived" : "Restored"} ${ctx.objectType} pipeline ${p.name.en}`, object: { table: "pipelines", id: p.id }, detail: { object: ctx.objectType, key } });
  return okResult(archived ? PT.pipelineArchived(p.name.en) : PT.pipelineRestored(p.name.en), { sub: warn });
}

/**
 * Save the whole stage list of one pipeline. `inputs` is in board order (live stages first); stages with `id` already
 * exist and carry the `version` the editor loaded, new ones have no id. Existing stages cannot be omitted.
 */
export async function saveStages(ctx: PipeCtx, pipelineKey: string, inputs: StageInput[]): Promise<ActionResult<{ added: string[]; archived: string[]; changed: string[] }>> {
  const p = await findPipeline(ctx, pipelineKey);
  if (!p) return failResult("not_found", PT.pipelineGone);
  const issues = validateStageInputs(ctx.objectType, inputs, { customKeys: ctx.customKeys });
  if (issues.length) return failResult("invalid", issues[0].message, { issues });
  const byId = new Map(p.stages.map((s) => [s.id, s]));
  const seen = new Set<string>();
  for (const s of inputs) {
    if (!s.id) continue;
    const cur = byId.get(s.id);
    if (!cur) return failResult("not_found", PT.stageGone);
    if (s.key && s.key !== cur.key) return bad(PT.keyLocked);
    seen.add(s.id);
  }
  if (p.stages.some((s) => !seen.has(s.id))) return stale(); // the list changed under the editor
  for (const s of inputs) {
    const cur = s.id ? byId.get(s.id) : undefined;
    if (cur && s.archived && !cur.archived && (await ctx.deps.countInStage(ctx.objectType, cur.id)) > 0) return bad(PT.stageInUse(cur.name.en));
  }
  // final order: live stages first, archived after, 1-based
  const ordered = [...inputs.filter((s) => !s.archived), ...inputs.filter((s) => s.archived)];
  const taken = new Set(p.stages.map((s) => s.key));
  const added: string[] = [], archived: string[] = [], changed: string[] = [];
  const finalPos: { id: string; position: number }[] = [];
  let tmp = 2000;
  try {
    for (const [i, s] of ordered.entries()) {
      const position = i + 1;
      const cur = s.id ? byId.get(s.id) : undefined;
      if (cur) {
        const name = { ...cur.name, en: s.name.trim() };
        const same = name.en === cur.name.en && s.probability === cur.probability && s.color === cur.color && s.outcome === cur.outcome && s.slaHours === cur.slaHours
          && s.archived === cur.archived && JSON.stringify(s.requiredFields) === JSON.stringify(cur.requiredFields);
        let version = cur.version;
        if (!same) {
          const saved = await ctx.deps.updateStageGuarded(ctx.ws, cur.id, s.version ?? cur.version, writeOf(s, name, cur.position), cur.archived);
          version = saved.version; changed.push(cur.key);
          if (s.archived && !cur.archived) archived.push(cur.key);
        }
        void version;
        if (cur.position !== position) finalPos.push({ id: cur.id, position });
      } else {
        const key = keyFromName(s.name, taken); taken.add(key);
        const made = await ctx.deps.insertStage({ ws: ctx.ws, tenantId: ctx.tenantId, pipelineId: p.id, key, write: writeOf(s, { en: s.name.trim() }, tmp++) });
        added.push(key); finalPos.push({ id: made.id, position });
      }
    }
    if (finalPos.length) await ctx.deps.setStagePositions(ctx.ws, finalPos);
  } catch (e) {
    if (e instanceof DbError && e.code === "conflict") return stale();
    if (e instanceof DbError && e.code === "unique") return bad(PT.keyTaken);
    throw e;
  }
  if (!added.length && !changed.length && !finalPos.length) return okResult(PT.nothingChanged, { data: { added, archived, changed } });
  const warn = await trail(ctx, p, "stages_saved", { action: "pipelines.stages_saved", summary: `Saved ${ctx.objectType} pipeline ${p.name.en}: ${added.length} added, ${changed.length} changed, ${archived.length} archived`, object: { table: "pipelines", id: p.id }, detail: { object: ctx.objectType, key: p.key, added, changed, archived } },
    { added: added.length, changed: changed.length, archived: archived.length });
  return okResult(PT.stagesSaved(p.name.en), { sub: warn, data: { added, archived, changed } });
}
