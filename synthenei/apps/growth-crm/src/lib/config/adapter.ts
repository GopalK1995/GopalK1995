// Bridge from the tenant config to the UI agent's vocabulary layer (vertical.ts TenantConfigOverrides).
// Pure and serialisable: the result travels from the server layout to client components via ShellCtx, and
// vertical.ts merges it over the preset, so pages keep calling vocabFor()/useVocab() unchanged.
import type { TenantConfigOverrides } from "../vertical";
import { stageList, type StageCfg, type StageKind, type TenantConfig } from "./types";

const labels = (st: Record<string, StageCfg>) => Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v.label]));
export function toVerticalOverrides(c: TenantConfig): TenantConfigOverrides {
  return {
    preset: c.preset, search: c.vocabulary.search, n: c.vocabulary.n, nav: c.vocabulary.nav, funnel: c.vocabulary.funnel, views: c.vocabulary.views,
    leadStage: labels(c.stages.lead) as never, dealStage: labels(c.stages.deal) as never,
    partySize: c.taxonomies.partySize, channelFamily: c.taxonomies.channelFamily, lost: c.taxonomies.lost, plans: c.taxonomies.plans,
    modules: c.modules, features: c.features, fonts: c.branding.fonts, kpiTiles: c.dashboard.kpiTiles,
  };
}
/** Stage metadata for boards, funnels and forecasts: ordered ids with probability, colour token and outcome. */
export const stageMeta = (c: TenantConfig, kind: StageKind) => {
  const st = c.stages[kind] as Record<string, StageCfg>;
  return stageList(st).map((id) => ({ id, ...st[id] }));
};
export const stageProbability = (c: TenantConfig, kind: StageKind, id: string) => (c.stages[kind] as Record<string, StageCfg>)[id]?.probability ?? 0;
