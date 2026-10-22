// Presets are code; a tenant's overrides are data. The vocabulary/modules/fonts values come from the UI agent's
// PRESETS in vertical.ts (single source of truth, so a tenant with no overrides renders exactly as today).
// This file adds what vertical.ts does not carry: stage metadata, taxonomy extras, dashboard and data defaults.
import { MODULE_KEYS, PRESETS } from "../vertical";
import type { DealStage, LeadStage } from "../data/types";
import { CONFIG_VERSION, DEAL_STAGE_IDS, LEAD_STAGE_IDS, type FontKey, type BusinessHours, type ModuleId, type PresetId, type StageCfg, type StageColor, type TenantConfig } from "./types";

export interface BrandDefaults { id: string; name: string; product: string; hue: number }

const LEAD_META: Record<LeadStage, [number, StageColor, "open" | "won" | "lost"]> = {
  new: [5, "neutral", "open"], contacted: [10, "info", "open"], qualified: [25, "info", "open"], demo_booked: [40, "accent", "open"],
  demo_done: [50, "accent", "open"], proposal: [65, "warn", "open"], won: [100, "success", "won"], lost: [0, "danger", "lost"],
};
const DEAL_META: Record<DealStage, [number, StageColor, "open" | "won" | "lost"]> = {
  discovery: [10, "neutral", "open"], demo_scheduled: [25, "info", "open"], demo_done: [40, "info", "open"], proposal: [60, "warn", "open"],
  negotiation: [80, "warn", "open"], won: [100, "success", "won"], lost: [0, "danger", "lost"],
};
const stagesOf = <K extends string>(ids: K[], labels: Record<K, string>, meta: Record<K, [number, StageColor, "open" | "won" | "lost"]>) =>
  Object.fromEntries(ids.map((id, order) => [id, { label: labels[id], order, probability: meta[id][0], color: meta[id][1], outcome: meta[id][2] } satisfies StageCfg])) as Record<K, StageCfg>;

const INTERESTS: Record<PresetId, string[]> = {
  legal: ["Civil", "Criminal", "Family", "Property", "Corporate", "Labour", "Tax"],
  hospitality: ["Couples", "Family", "Friends group", "Workation", "Wedding & events", "Corporate retreat", "Trekking"],
  blank: [],
};
const HOURS: Record<PresetId, BusinessHours> = {
  legal: { days: [1, 2, 3, 4, 5, 6], start: "10:00", end: "19:00" },
  hospitality: { days: [0, 1, 2, 3, 4, 5, 6], start: "08:00", end: "21:00" },
  blank: { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" },
};
export const DEFAULT_CHARTS = ["perDay", "mix", "funnel", "cpd", "accounts", "team"];

/** The full config of a preset for a tenant (tenant record supplies the brand defaults). */
export function presetConfig(id: PresetId, tenant: BrandDefaults): TenantConfig {
  const p = PRESETS[id];
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  const modules = Object.fromEntries(MODULE_KEYS.map((k) => [k, p.modules[k] !== false])) as Record<ModuleId, boolean>;
  return {
    v: CONFIG_VERSION, preset: id,
    vocabulary: { n: clone(p.n), nav: clone(p.nav), search: p.search, funnel: clone(p.funnel), views: clone(p.views) },
    stages: { lead: stagesOf(LEAD_STAGE_IDS, p.leadStage, LEAD_META), deal: stagesOf(DEAL_STAGE_IDS, p.dealStage, DEAL_META) },
    taxonomies: { partySize: clone(p.partySize), channelFamily: clone(p.channelFamily), lost: clone(p.lost), plans: clone(p.plans), interests: [...INTERESTS[id]] },
    modules, modulesLocked: [],
    features: { ecourts: p.features.ecourts, hearings: p.features.hearings },
    branding: { name: tenant.name, product: tenant.product, hue: tenant.hue, fonts: { heading: p.fonts.heading as FontKey, body: p.fonts.body as FontKey } },
    dashboard: { kpiTiles: [...p.kpiTiles], charts: [...DEFAULT_CHARTS], catalogueExtra: [] },
    data: { sampleData: true, slaHours: 2, targetPerRepMonthly: null, businessHours: clone(HOURS[id]), importMappings: { leads: {}, accounts: {}, campaigns: {} } },
  };
}
