// "collab" namespace lookup. Reads messages/en/collab.json directly until the integrator registers the namespace in
// src/i18n/registry.ts (same approach as tasks). Tamil drafts live in messages/ta/collab.json, flagged _review.
import en from "../../../messages/en/collab.json";

type Dict = Record<string, string>;
export const fill = (s: string, vars: Record<string, string | number> = {}) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
export function ct(key: string, vars?: Record<string, string | number>): string {
  const v = (en as Dict)[key];
  return typeof v === "string" ? fill(v, vars) : key;
}
/** Every string, for client components ({n}, {name} stay as placeholders; fill on the client). */
export const ctAll = (): Dict => Object.fromEntries(Object.entries(en as Dict).filter(([k]) => k !== "_review"));
