// Pipeline strings. The shared i18n registry is not edited by this task (see docs/tasks/T014.md), so the
// namespace JSON is imported here and layered with the tenant vocabulary ({deal}, {deals}, {owner}).
import en from "../../../../../messages/en/pipeline.json";
import ta from "../../../../../messages/ta/pipeline.json";

export type PipelineLabels = Record<keyof typeof en, string>;
export const PIPELINE_BASE: Record<"en" | "ta", PipelineLabels> = { en, ta };

/** Replaces {name} placeholders. Unknown placeholders are left as written. */
export const fill = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));

/** Labels for a locale with the vertical's deal nouns applied; plain strings so they can cross to client components. */
export function pipelineLabels(locale: "en" | "ta", nouns: { deal: string; deals: string }): PipelineLabels {
  const base = PIPELINE_BASE[locale] ?? en;
  return Object.fromEntries(Object.entries(base).map(([k, s]) => [k, fill(s, nouns)])) as PipelineLabels;
}
