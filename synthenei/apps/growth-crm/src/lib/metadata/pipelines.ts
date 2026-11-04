// Pipelines and stages as data (CONTRACTS C13). Pure module: types, the config-document adapter used by demo sessions,
// stage-set validation, and the required-field check a stage move runs. DB access lives in pipelines-repo.ts.
// Real workspaces keep pipelines in `pipelines` / `pipeline_stages` (0017); demo workspaces keep the same shape in the
// tenant config document (`stages.deal`, `stages.lead`, `pipelines`), so every consumer sees one `Pipeline[]`.
import { MAX_STAGES_PER_PIPELINE, PIPELINE_KEY_RE, REQUIRED_FIELD_RE, STAGE_COLORS, STAGE_KEY_RE, stageListAll, validateStages, type Outcome, type StageCfg, type StageColor, type TenantConfig } from "@/lib/config/types";
import type { I18nLabel } from "./types";

export type PipelineObject = "lead" | "deal";
export const DEFAULT_PIPELINE_KEY: Record<PipelineObject, string> = { lead: "leads", deal: "sales" };

export interface Stage {
  /** pipeline_stages.id (real) or `cfg:<pipeline>:<key>` (demo). */
  id: string; key: string; name: I18nLabel; position: number; probability: number; color: StageColor; outcome: Outcome;
  slaHours: number | null; requiredFields: string[]; archived: boolean;
  /** Row version for optimistic concurrency (real workspaces; 0 for config-backed stages). */
  version: number;
}
export interface Pipeline { id: string; key: string; objectType: PipelineObject; name: I18nLabel; isDefault: boolean; position: number; archived: boolean; stages: Stage[] }

/** What the editor sends for one stage; order in the array is the order on the board. */
export interface StageInput {
  /** Existing stage: its key. A new stage may omit it (derived from the name). */
  key?: string; id?: string; version?: number;
  name: string; probability: number; color: StageColor; outcome: Outcome; slaHours: number | null; requiredFields: string[]; archived: boolean;
}

export const label = (n: I18nLabel, locale: "en" | "ta" = "en") => (locale === "ta" && n.ta ? n.ta : n.en);

// ------------------------------------------------------------------------------------------ config-backed pipelines (demo)
const stageFromCfg = (pipeline: string, key: string, c: StageCfg): Stage => ({
  id: `cfg:${pipeline}:${key}`, key, name: { en: c.label }, position: c.order, probability: c.probability, color: c.color, outcome: c.outcome,
  slaHours: c.slaHours ?? null, requiredFields: c.requiredFields ?? [], archived: !!c.archived, version: 0,
});
const stagesFromCfg = (pipeline: string, st: Record<string, StageCfg>): Stage[] => stageListAll(st).map((k) => stageFromCfg(pipeline, k, st[k]));

/** All pipelines of an object type from the effective tenant config. The default comes first. Leads have one pipeline. */
export function pipelinesFromConfig(cfg: TenantConfig, objectType: PipelineObject): Pipeline[] {
  const defKey = DEFAULT_PIPELINE_KEY[objectType];
  const def: Pipeline = { id: `cfg:${defKey}`, key: defKey, objectType, name: { en: objectType === "lead" ? "Lead pipeline" : "Sales pipeline" }, isDefault: true, position: 0, archived: false, stages: stagesFromCfg(defKey, cfg.stages[objectType]) };
  if (objectType === "lead") return [def];
  const extra = Object.entries(cfg.pipelines ?? {}).sort((a, b) => a[1].order - b[1].order).map(([k, p]): Pipeline => ({ id: `cfg:${k}`, key: k, objectType, name: { en: p.name }, isDefault: false, position: p.order + 1, archived: !!p.archived, stages: stagesFromCfg(k, p.stages) }));
  return [def, ...extra];
}

/** The pipeline a page should show: the requested key if it exists and is live, else the default, else the first live one. */
export function pickPipeline(pipelines: Pipeline[], key?: string | null): Pipeline | null {
  const live = pipelines.filter((p) => !p.archived);
  return live.find((p) => p.key === key) ?? live.find((p) => p.isDefault) ?? live[0] ?? null;
}
export const liveStages = (p: Pipeline) => p.stages.filter((s) => !s.archived).sort((a, b) => a.position - b.position);

// ------------------------------------------------------------------------------------------ keys and validation
/** Stable snake_case key from a name: "Site visit" -> "site_visit". Never empty and always valid. */
export function keyFromName(name: string, taken: Iterable<string>, fallback = "stage"): string {
  const used = new Set(taken);
  let base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z]/.test(base)) base = `${fallback}_${base}`.replace(/_+$/, "");
  base = base.slice(0, 28) || fallback;
  if (base.length < 2) base = `${base}_1`;
  let k = base, i = 2;
  while (used.has(k)) k = `${base.slice(0, 28)}_${i++}`;
  return k;
}

/** Core fields a stage can require, per record type. Values are read through `coreValue()`. */
export const REQUIRED_FIELD_CATALOGUE: Record<PipelineObject, { key: string; label: string }[]> = {
  deal: [{ key: "value", label: "Value" }, { key: "seats", label: "Quantity" }, { key: "expected_close", label: "Expected close date" }, { key: "next_step", label: "Next step" }, { key: "owner", label: "Owner" }],
  lead: [{ key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "city", label: "City" }, { key: "owner", label: "Owner" }],
};
export const requiredFieldLabel = (objectType: PipelineObject, key: string, custom: { key: string; label: string }[] = []) =>
  REQUIRED_FIELD_CATALOGUE[objectType].find((f) => f.key === key)?.label ?? custom.find((f) => `custom.${f.key}` === key)?.label ?? key.replace(/^custom\./, "").replace(/_/g, " ");

export type Issue = { path: string; message: string };

/** Validates a whole stage list as the editor would save it. Archived stages are not checked for name clashes. */
export function validateStageInputs(objectType: PipelineObject, inputs: StageInput[], opts: { customKeys?: string[] } = {}): Issue[] {
  const issues: Issue[] = [];
  if (inputs.length > MAX_STAGES_PER_PIPELINE) issues.push({ path: "stages", message: `At most ${MAX_STAGES_PER_PIPELINE} stages.` });
  const known = new Set([...REQUIRED_FIELD_CATALOGUE[objectType].map((f) => f.key), ...(opts.customKeys ?? []).map((k) => `custom.${k}`)]);
  const keys = new Set<string>();
  inputs.forEach((s, i) => {
    const p = `stages.${i}`;
    if (!s.name.trim()) issues.push({ path: `${p}.name`, message: "Every stage needs a name." });
    else if (s.name.trim().length > 32) issues.push({ path: `${p}.name`, message: "Stage names are at most 32 characters." });
    if (s.key && !STAGE_KEY_RE.test(s.key)) issues.push({ path: `${p}.key`, message: "Stage id: lowercase letters, digits, underscore." });
    if (s.key) { if (keys.has(s.key)) issues.push({ path: `${p}.key`, message: "Stage ids must be unique." }); keys.add(s.key); }
    if (!(STAGE_COLORS as readonly string[]).includes(s.color)) issues.push({ path: `${p}.color`, message: "Unknown colour." });
    if (!Number.isInteger(s.probability) || s.probability < 0 || s.probability > 100) issues.push({ path: `${p}.probability`, message: "Probability is a whole number from 0 to 100." });
    if (s.slaHours !== null && (!Number.isInteger(s.slaHours) || s.slaHours < 1 || s.slaHours > 8760)) issues.push({ path: `${p}.slaHours`, message: "SLA is 1 to 8760 hours, or empty." });
    for (const f of s.requiredFields) {
      if (!REQUIRED_FIELD_RE.test(f)) issues.push({ path: `${p}.requiredFields`, message: `"${f}" is not a field key.` });
      else if (!known.has(f)) issues.push({ path: `${p}.requiredFields`, message: `"${f}" is not a field on this record.` });
    }
  });
  const taken: string[] = [];
  const map: Record<string, StageCfg> = {};
  inputs.forEach((s, i) => {
    const key = s.key ?? keyFromName(s.name, [...taken, ...inputs.map((x) => x.key).filter((k): k is string => !!k)]);
    taken.push(key);
    map[key] = { label: s.name.trim(), order: i, probability: s.probability, color: s.color, outcome: s.outcome, slaHours: s.slaHours, requiredFields: s.requiredFields, archived: s.archived };
  });
  issues.push(...validateStages("stages", map, false).map((x) => ({ path: x.path, message: x.message })));
  return issues;
}

/** Moves `key` one place among the live stages; archived stages keep their slots at the end. */
export function reorderStages<T extends { key?: string; archived: boolean }>(list: T[], index: number, delta: -1 | 1): T[] {
  const live = list.filter((s) => !s.archived), dead = list.filter((s) => s.archived);
  const j = index + delta;
  if (index < 0 || index >= live.length || j < 0 || j >= live.length) return list;
  [live[index], live[j]] = [live[j], live[index]];
  return [...live, ...dead];
}

/** Won and Lost stages sit at the end of the board in this order regardless of position typos. */
export const outcomeRank = (o: Outcome) => (o === "open" ? 0 : o === "won" ? 1 : 2);

// ------------------------------------------------------------------------------------------ required fields on move
/** A record viewed through the catalogue keys, whatever its source (domain object in demo, table row in real sessions). */
export interface RequiredView { core: Record<string, unknown>; custom: Record<string, unknown> }

const blank = (key: string, v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim()) || ((key === "value" || key === "seats") && typeof v === "number" && v <= 0);

/** Keys of `required` that the record does not have. `extra` carries values the move itself supplies (a Won form, for example). */
export function missingRequired(required: string[], rec: RequiredView, extra: Record<string, unknown> = {}): string[] {
  return required.filter((k) => {
    const own = k.startsWith("custom.") ? rec.custom[k.slice(7)] : rec.core[k];
    const given = k.startsWith("custom.") ? undefined : extra[k];
    return blank(k, given ?? own);
  });
}

/** Domain deal (demo / mapped) -> catalogue view. `nextStepAt` comes from the linked lead. */
export function viewOfDeal(d: { value: number; seats: number; expectedClose: string; ownerId: string }, nextStepAt: string | null): RequiredView {
  return { core: { value: d.value, seats: d.seats, expected_close: d.expectedClose, next_step: nextStepAt, owner: d.ownerId }, custom: {} };
}
/** deals table row (camelCase from the repo) -> catalogue view. */
export function viewOfDealRow(r: Record<string, unknown>): RequiredView {
  const c = r.custom && typeof r.custom === "object" ? (r.custom as Record<string, unknown>) : {};
  return { core: { value: r.valueInr, seats: r.seats, expected_close: r.expectedCloseOn, next_step: r.nextStep ?? r.nextStepAt, owner: r.ownerId }, custom: c };
}

export const PIPELINE_KEY_OK = (k: string) => PIPELINE_KEY_RE.test(k);
