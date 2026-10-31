// Inbox namespace lookup. Reads messages/en/inbox.json directly until the integrator registers the `inbox` namespace in
// src/i18n/registry.ts. Nouns come from vocabFor so each vertical keeps its own words (no law words for non-legal tenants).
import en from "../../../../../messages/en/inbox.json";
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
export function it(v: Vocab) {
  const base = nounVars(v);
  return (key: string, vars: Record<string, string | number> = {}) => fill(get(key), { ...base, ...vars });
}
/** Every string with the vertical's nouns filled in, for client components. */
export function itAll(v: Vocab): Record<string, string> {
  const base = nounVars(v);
  return Object.fromEntries(Object.entries(en as Tree).filter(([k, s]) => typeof s === "string" && k !== "_review").map(([k, s]) => [k, fill(s as string, base)]));
}
