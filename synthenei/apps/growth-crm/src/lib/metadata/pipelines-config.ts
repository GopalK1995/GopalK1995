// Pipeline edits for config-backed (demo) workspaces: builds the sparse config patch that config/apply.ts validates,
// authorizes ("stages" section) and stores. Pure. Real workspaces use pipelines-admin.ts instead.
import { MAX_EXTRA_PIPELINES, type StageCfg, type TenantConfig } from "@/lib/config/types";
import { DEFAULT_PIPELINE_KEY, keyFromName, pipelinesFromConfig, validateStageInputs, type Issue, type PipelineObject, type StageInput } from "./pipelines";
import { PT } from "./pipelines-strings";

export type PatchResult = { ok: true; patch: Record<string, unknown>; message: string; added: string[]; archived: string[] } | { ok: false; message: string; issues: Issue[] };
const no = (message: string, path = "stages"): PatchResult => ({ ok: false, message, issues: [{ path, message }] });

/** Full StageCfg map for an edited list (order = position in the list; live stages first). */
export function stageCfgFromInputs(inputs: StageInput[], existing: string[]): { stages: Record<string, StageCfg>; keys: string[]; added: string[] } {
  const taken = new Set([...existing, ...inputs.map((s) => s.key).filter((k): k is string => !!k)]);
  const ordered = [...inputs.filter((s) => !s.archived), ...inputs.filter((s) => s.archived)];
  const stages: Record<string, StageCfg> = {}, keys: string[] = [], added: string[] = [];
  ordered.forEach((s, order) => {
    let key = s.key;
    if (!key) { key = keyFromName(s.name, taken); taken.add(key); added.push(key); }
    keys.push(key);
    stages[key] = { label: s.name.trim(), order, probability: s.probability, color: s.color, outcome: s.outcome, slaHours: s.slaHours, requiredFields: s.requiredFields, archived: s.archived };
  });
  return { stages, keys, added };
}

/** Save the stage list of one pipeline (default `stages.<type>` or an extra pipeline). `openIn(key)` = records still in a stage. */
export function patchSaveStages(cfg: TenantConfig, objectType: PipelineObject, pipelineKey: string, inputs: StageInput[], openIn: (stageKey: string) => number, customKeys: string[] = []): PatchResult {
  const p = pipelinesFromConfig(cfg, objectType).find((x) => x.key === pipelineKey);
  if (!p) return no(PT.pipelineGone, "pipeline");
  const issues = validateStageInputs(objectType, inputs, { customKeys });
  if (issues.length) return { ok: false, message: issues[0].message, issues };
  const cur = new Map(p.stages.map((s) => [s.key, s]));
  for (const s of inputs) if (s.key && !cur.has(s.key)) return no(PT.stageGone);
  if (p.stages.some((s) => !inputs.some((i) => i.key === s.key))) return no(PT.conflictBody);
  for (const s of inputs) { const c = s.key ? cur.get(s.key) : undefined; if (c && s.archived && !c.archived && openIn(c.key) > 0) return no(PT.stageInUse(c.name.en)); }
  const built = stageCfgFromInputs(inputs, p.stages.map((s) => s.key));
  const archived = inputs.filter((s) => s.archived && s.key && !cur.get(s.key)?.archived).map((s) => s.key as string);
  const patch = p.isDefault ? { stages: { [objectType]: built.stages } } : { pipelines: { [pipelineKey]: { name: p.name.en, order: p.position - 1, stages: built.stages } } };
  return { ok: true, patch, message: PT.stagesSaved(p.name.en), added: built.added, archived };
}

export function patchCreatePipeline(cfg: TenantConfig, objectType: PipelineObject, name: string): PatchResult & { key?: string } {
  const nm = name.trim();
  if (objectType === "lead") return no(PT.leadSingle);
  if (!nm) return no(PT.pipelineNeedsName, "name");
  if (nm.length > 40) return no(PT.pipelineNameLong, "name");
  const all = pipelinesFromConfig(cfg, objectType);
  if (all.filter((p) => !p.isDefault && !p.archived).length >= MAX_EXTRA_PIPELINES) return no(PT.pipelineLimit(MAX_EXTRA_PIPELINES));
  if (all.some((p) => !p.archived && p.name.en.toLowerCase() === nm.toLowerCase())) return no(PT.pipelineNameTaken, "name");
  const key = keyFromName(nm, all.map((p) => p.key), "pipeline");
  const stages: Record<string, StageCfg> = {
    new: { label: "New", order: 0, probability: 10, color: "neutral", outcome: "open", slaHours: null, requiredFields: [], archived: false },
    won: { label: "Won", order: 1, probability: 100, color: "success", outcome: "won", slaHours: null, requiredFields: [], archived: false },
    lost: { label: "Lost", order: 2, probability: 0, color: "danger", outcome: "lost", slaHours: null, requiredFields: [], archived: false },
  };
  return { ok: true, key, patch: { pipelines: { [key]: { name: nm, order: Math.max(0, ...all.map((p) => p.position)), stages } } }, message: PT.pipelineCreated(nm), added: [], archived: [] };
}

export function patchRenamePipeline(cfg: TenantConfig, key: string, name: string): PatchResult {
  const nm = name.trim();
  const all = pipelinesFromConfig(cfg, "deal");
  const p = all.find((x) => x.key === key);
  if (!p || p.isDefault) return no(PT.pipelineGone, "pipeline");
  if (!nm) return no(PT.pipelineNeedsName, "name");
  if (nm.length > 40) return no(PT.pipelineNameLong, "name");
  if (all.some((x) => x.key !== key && !x.archived && x.name.en.toLowerCase() === nm.toLowerCase())) return no(PT.pipelineNameTaken, "name");
  return { ok: true, patch: { pipelines: { [key]: { name: nm } } }, message: PT.pipelineRenamed(nm), added: [], archived: [] };
}

export function patchArchivePipeline(cfg: TenantConfig, key: string, archived: boolean, openIn: (pipelineKey: string) => number): PatchResult {
  const p = pipelinesFromConfig(cfg, "deal").find((x) => x.key === key);
  if (!p) return no(PT.pipelineGone, "pipeline");
  if (p.isDefault) return no(PT.defaultKeeps);
  if (archived && openIn(key) > 0) return no(PT.pipelineInUse(p.name.en));
  return { ok: true, patch: { pipelines: { [key]: { archived } } }, message: archived ? PT.pipelineArchived(p.name.en) : PT.pipelineRestored(p.name.en), added: [], archived: [] };
}

export { DEFAULT_PIPELINE_KEY };
