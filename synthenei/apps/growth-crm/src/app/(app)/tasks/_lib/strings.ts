// Tasks namespace lookup. Reads messages/en/tasks.json directly until the integrator registers the `tasks` namespace in
// src/i18n/registry.ts. Nouns come from vocabFor so each vertical keeps its own words and no copy is shared across tenants.
import en from "../../../../../messages/en/tasks.json";
import { cap, type Vocab } from "@/lib/vertical";

type Tree = { [k: string]: string | Tree };
const get = (path: string): string => {
  const v = (en as Tree)[path];
  return typeof v === "string" ? v : path;
};
export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));

export function nounVars(v: Vocab) {
  return { noun: v.n.lead.one, nouns: v.n.lead.many, Noun: cap(v.n.lead.one) };
}
/** tt(vocab)("leadNotFound") -> "Lead not found..." | "Enquiry not found...". Extra vars override. */
export function tt(v: Vocab) {
  const base = nounVars(v);
  return (key: string, vars: Record<string, string | number> = {}) => fill(get(key), { ...base, ...vars });
}
/** Every string with the vertical's nouns filled in, for client components ({n}, {title}... stay as placeholders). */
export function ttAll(v: Vocab): Record<string, string> {
  const base = nounVars(v);
  return Object.fromEntries(Object.entries(en as Tree).filter(([k, s]) => typeof s === "string" && k !== "_review").map(([k, s]) => [k, fill(s as string, base)]));
}
