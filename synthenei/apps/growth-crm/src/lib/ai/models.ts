// Model catalogue for the AI gateway. Kept in code (not in the DB) so ids and prices update with a deploy.
// Prices are USD per million tokens, which equals micro-USD per token (cost_micro_usd = in * inUsdPerM + out * outUsdPerM).
// Price values are list-price estimates the owner must confirm against the vendor invoice before relying on cost caps in money.
import type { ProviderId } from "./types";

export type Tier = "draft" | "fast" | "deep";
export interface ModelDef { id: string; provider: ProviderId; label: string; tier: Tier; inUsdPerM: number; outUsdPerM: number }

export const MODELS: readonly ModelDef[] = [
  { id: "claude-sonnet-5-5", provider: "anthropic", label: "Claude Sonnet 5.5", tier: "draft", inUsdPerM: 3, outUsdPerM: 15 },
  { id: "claude-haiku-5-5", provider: "anthropic", label: "Claude Haiku 5.5", tier: "fast", inUsdPerM: 1, outUsdPerM: 5 },
  { id: "claude-opus-5-5", provider: "anthropic", label: "Claude Opus 5.5", tier: "deep", inUsdPerM: 5, outUsdPerM: 25 },
  { id: "gpt-4.1", provider: "openai", label: "GPT-4.1", tier: "draft", inUsdPerM: 2, outUsdPerM: 8 },
  { id: "gpt-4.1-mini", provider: "openai", label: "GPT-4.1 mini", tier: "fast", inUsdPerM: 0.4, outUsdPerM: 1.6 },
  { id: "gemini-2.5-pro", provider: "google", label: "Gemini 2.5 Pro", tier: "draft", inUsdPerM: 1.25, outUsdPerM: 10 },
  { id: "gemini-2.5-flash", provider: "google", label: "Gemini 2.5 Flash", tier: "fast", inUsdPerM: 0.3, outUsdPerM: 2.5 },
];

export const DEFAULT_PROVIDER: ProviderId = "anthropic";
export const modelDef = (id: string) => MODELS.find((m) => m.id === id) ?? null;
export const modelsOf = (p: ProviderId) => MODELS.filter((m) => m.provider === p);
/** Default model of a provider for a tier; deep falls back to draft when the provider has no deep model. */
export function defaultModel(p: ProviderId, tier: Tier): string | null {
  const l = modelsOf(p);
  return (l.find((m) => m.tier === tier) ?? l.find((m) => m.tier === "draft") ?? l[0])?.id ?? null;
}
export function costMicroUsd(model: string, inTok: number, outTok: number): number {
  const m = modelDef(model);
  return m ? Math.round(inTok * m.inUsdPerM + outTok * m.outUsdPerM) : 0;
}
