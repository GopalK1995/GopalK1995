// Resolves the pipelines a request should use. Demo sessions read the effective tenant config (and never create a Supabase
// client); real sessions read the pipelines tables through the request client (RLS: members of the workspace may read).
// A real workspace with no pipeline rows yet (migration 0017 seeds them, but a fresh one may lag) falls back to the config.
import type { TenantConfig } from "@/lib/config/types";
import { DB_SEED_LABELS } from "@/lib/config/presets";
import { pipelinesFromConfig, type Pipeline, type PipelineObject } from "./pipelines";
import { listPipelines } from "./pipelines-repo";

/** CONTRACTS C13: `getPipelines(ws, objectType)`. `ws` is the workspace uuid. */
export const getPipelines = (ws: string, objectType: PipelineObject): Promise<Pipeline[]> => listPipelines(ws, objectType);

/**
 * Real workspaces: a stage still named as the database seeded it shows the tenant vocabulary's label (so a hospitality
 * workspace reads "Quote sent", not the seeded "Demo scheduled"); a renamed stage shows its own name. Demo pipelines come
 * from the config and already carry the vocabulary.
 */
export function withVocabLabels(pipelines: Pipeline[], objectType: PipelineObject, vocab: Record<string, string>): Pipeline[] {
  return pipelines.map((p) => (p.isDefault ? { ...p, stages: p.stages.map((s) => (s.name.en === DB_SEED_LABELS[objectType][s.key] && vocab[s.key] ? { ...s, name: { ...s.name, en: vocab[s.key] } } : s)) } : p));
}

export async function loadPipelines(ctx: { cfg: TenantConfig; session: { demo: boolean }; active: { ws: { uuid: string } } }, objectType: PipelineObject): Promise<Pipeline[]> {
  if (ctx.session.demo) return pipelinesFromConfig(ctx.cfg, objectType);
  const rows = await getPipelines(ctx.active.ws.uuid, objectType);
  const vocab = Object.fromEntries(Object.entries(ctx.cfg.stages[objectType]).map(([k, s]) => [k, s.label]));
  return rows.length ? withVocabLabels(rows, objectType, vocab) : pipelinesFromConfig(ctx.cfg, objectType);
}
