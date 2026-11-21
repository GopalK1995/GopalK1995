// Feature flags as the app reads them (AiSettings). Pure: the policy row is read by the caller. Absent or non-true = off.
import type { AiSettings } from "@/lib/data/types";

export const AI_OFF_SETTINGS: AiSettings = { scoring: true, summaries: false, nextBestAction: false, replyDrafts: false, campaignDigest: false, askCrm: false };

export function aiSettingsFromFeatures(features: unknown): AiSettings {
  const f = features && typeof features === "object" && !Array.isArray(features) ? (features as Record<string, unknown>) : {};
  const on = (k: string) => f[k] === true;
  return { scoring: true, summaries: on("lead_summary"), nextBestAction: on("next_best_action"), replyDrafts: on("reply_draft"), campaignDigest: false, askCrm: on("ask_crm") };
}
