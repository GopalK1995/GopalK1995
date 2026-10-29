// Accounts namespace lookup. Reads messages/en/accounts.json directly until the integrator registers `accounts` in
// src/i18n/registry.ts. Nouns come from the tenant vertical: legal = "law firm", hospitality = "guest/partner",
// anything else = the vertical's own firm noun. Never reuse copy or ids across tenants.
import en from "../../../../../messages/en/accounts.json";
import { cap, type Vocab } from "@/lib/vertical";

type Tree = { [k: string]: string | Tree };
const get = (path: string): string => {
  let cur: string | Tree = en as Tree;
  for (const p of path.split(".")) { if (typeof cur === "string") return path; cur = (cur as Tree)[p]; if (cur === undefined) return path; }
  return typeof cur === "string" ? cur : path;
};

export function accountNoun(v: Vocab): { one: string; many: string } {
  if (v.id === "legal") return { one: "law firm", many: "law firms" };
  if (v.id === "hospitality") return { one: "guest/partner", many: "guests and partners" };
  return v.n.firm;
}
export function nounVars(v: Vocab) {
  const n = accountNoun(v);
  return { noun: n.one, nouns: n.many, Noun: cap(n.one) };
}
/** at(vocab)("created") -> "Law firm added" | "Guest/partner added". Extra vars override. */
export function at(v: Vocab) {
  const base = nounVars(v);
  return (key: string, vars: Record<string, string | number> = {}) =>
    get(key).replace(/\{(\w+)\}/g, (m, k: string) => String((k in vars ? vars[k] : (base as Record<string, string>)[k]) ?? m));
}
