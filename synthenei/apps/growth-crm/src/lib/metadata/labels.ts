// Object nouns from the tenant vocabulary, so a hospitality tenant sees "enquiry" and a legal tenant "lead".
import type { Vocab } from "@/lib/vertical";
import type { ObjectTypeDef } from "./types";

export function objectNoun(v: Vocab, key: string, obj?: Pick<ObjectTypeDef, "label" | "kind"> | null): { one: string; many: string } {
  if (obj?.kind === "custom") return obj.label.en;
  switch (key) {
    case "lead": return v.n.lead;
    case "deal": return v.n.deal;
    case "account": return v.n.firm;
    case "contact": return { one: "contact", many: "contacts" };
    case "task": return { one: "task", many: "tasks" };
    default: return obj?.label.en ?? { one: key, many: `${key}s` };
  }
}
