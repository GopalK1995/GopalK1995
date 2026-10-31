// Campaigns namespace lookup (reads messages/en/campaigns.json until the integrator registers the namespace in the i18n registry).
// Nouns come from vocabFor so each vertical keeps its own words.
import en from "../../../../../messages/en/campaigns.json";
import { cap, type Vocab } from "@/lib/vertical";

const get = (k: string): string => {
  const v = (en as Record<string, unknown>)[k];
  return typeof v === "string" ? v : k;
};
export const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in vars ? vars[k] : m));
export function tc(v: Vocab) {
  const base = { noun: v.n.lead.one, nouns: v.n.lead.many, Noun: cap(v.n.lead.one) };
  return (key: string, vars: Record<string, string | number> = {}) => fill(get(key), { what: "campaign", ...base, ...vars });
}
export function tcAll(v: Vocab): Record<string, string> {
  const base = { noun: v.n.lead.one, nouns: v.n.lead.many, Noun: cap(v.n.lead.one) };
  return Object.fromEntries(Object.entries(en as Record<string, unknown>).filter(([k, s]) => typeof s === "string" && k !== "_review").map(([k, s]) => [k, fill(s as string, base)]));
}
