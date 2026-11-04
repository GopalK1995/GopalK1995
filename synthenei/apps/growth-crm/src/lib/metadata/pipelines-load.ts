// Resolves the pipelines a request should use. Demo sessions read the effective tenant config (and never create a Supabase
// client); real sessions read the pipelines tables through the request client (RLS: members of the workspace may read).
// A real workspace with no pipeline rows yet (migration 0017 seeds them, but a fresh one may lag) falls back to the config.
import type { TenantConfig } from "@/lib/config/types";
import { pipelinesFromConfig, type Pipeline, type PipelineObject } from "./pipelines";
import { listPipelines } from "./pipelines-repo";

/** CONTRACTS C13: `getPipelines(ws, objectType)`. `ws` is the workspace uuid. */
export const getPipelines = (ws: string, objectType: PipelineObject): Promise<Pipeline[]> => listPipelines(ws, objectType);

export async function loadPipelines(ctx: { cfg: TenantConfig; session: { demo: boolean }; active: { ws: { uuid: string } } }, objectType: PipelineObject): Promise<Pipeline[]> {
  if (ctx.session.demo) return pipelinesFromConfig(ctx.cfg, objectType);
  const rows = await getPipelines(ctx.active.ws.uuid, objectType);
  return rows.length ? rows : pipelinesFromConfig(ctx.cfg, objectType);
}
