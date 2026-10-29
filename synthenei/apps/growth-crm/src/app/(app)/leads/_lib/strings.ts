// Leads namespace lookup. Reads messages/en/leads.json directly until the integrator registers the `leads` namespace in
// src/i18n/registry.ts (then swap to getT("leads")). Nouns always come from vocabFor so legal never says "enquiry"
// and hospitality never says "lead".
import en from "../../../../../messages/en/leads.json";
import { cap, type Vocab } from "@/lib/vertical";

type Tree = { [k: string]: string | Tree };
const get = (path: string): string => {
  let cur: string | Tree = en as Tree;
  for (const p of path.split(".")) { if (typeof cur === "string") return path; cur = (cur as Tree)[p]; if (cur === undefined) return path; }
  return typeof cur === "string" ? cur : path;
};

export function nounVars(v: Vocab) {
  return { noun: v.n.lead.one, nouns: v.n.lead.many, Noun: cap(v.n.lead.one) };
}
/** lt(vocab)("created") -> "Lead added" | "Enquiry added". Extra vars override. */
export function lt(v: Vocab) {
  const base = nounVars(v);
  return (key: string, vars: Record<string, string | number> = {}) =>
    get(key).replace(/\{(\w+)\}/g, (m, k: string) => String((k in vars ? vars[k] : (base as Record<string, string>)[k]) ?? m));
}
