// Badge tone for a stage. Stage colours are config data; the Badge component has its own tone vocabulary.
// A seeded stage whose colour the tenant has not changed keeps the tone the app always used (parity), anything else
// follows the configured colour.
import { stageListAll, type StageCfg, type StageColor, type StageKind, type TenantConfig } from "./types";

export type BadgeTone = "neutral" | "accent" | "success" | "danger" | "warn" | "outline";
export const COLOR_TONE: Record<StageColor, BadgeTone> = { neutral: "neutral", accent: "accent", info: "accent", warn: "warn", success: "success", danger: "danger" };

/** Tones of the seeded stages, as the app rendered them before stages became data. */
export const LEGACY_TONE: Record<StageKind, Record<string, BadgeTone>> = {
  lead: { new: "outline", contacted: "neutral", qualified: "neutral", demo_booked: "accent", demo_done: "accent", proposal: "warn", won: "success", lost: "danger" },
  deal: { discovery: "outline", demo_scheduled: "neutral", demo_done: "accent", proposal: "accent", negotiation: "warn", won: "success", lost: "danger" },
};
/** Colour each seeded stage has in every preset (presets.ts LEAD_META / DEAL_META). */
export const SEEDED_COLOR: Record<StageKind, Record<string, StageColor>> = {
  lead: { new: "neutral", contacted: "info", qualified: "info", demo_booked: "accent", demo_done: "accent", proposal: "warn", won: "success", lost: "danger" },
  deal: { discovery: "neutral", demo_scheduled: "info", demo_done: "info", proposal: "warn", negotiation: "warn", won: "success", lost: "danger" },
};

export function stageTone(kind: StageKind, key: string, color: StageColor | undefined): BadgeTone {
  if (!color) return LEGACY_TONE[kind][key] ?? "neutral";
  return SEEDED_COLOR[kind][key] === color && LEGACY_TONE[kind][key] ? LEGACY_TONE[kind][key] : COLOR_TONE[color];
}
/** Per-stage tones for the shell (serialisable). */
export const stageTones = (cfg: TenantConfig, kind: StageKind): Record<string, BadgeTone> => {
  const st = cfg.stages[kind] as Record<string, StageCfg>;
  return Object.fromEntries(stageListAll(st).map((k) => [k, stageTone(kind, k, st[k].color)]));
};
