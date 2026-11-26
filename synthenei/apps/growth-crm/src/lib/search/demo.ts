// Demo-mode search over the in-memory workspace dataset (demo sessions never create a Supabase client). Same rules as the real
// engine: only what the viewer may read, names masked to initials without personal-data access.
import { HIT_LIMIT, type SearchHit } from "./types";

export interface DemoLead { id: string; name: string; title: string; accountId: string; ownerId: string }
export interface DemoAccount { id: string; name: string; city: string; district: string }
export interface DemoRecord { id: string; title: string; data: Record<string, unknown>; objectKey: string; label: string }
export interface DemoTask { id: string; title: string; ownerId: string }
export interface DemoDeal { id: string; name: string; ownerId: string }
export interface DemoCampaign { id: string; name: string; status: string; utmCampaign: string }
export interface DemoInput {
  q: string;
  leads: DemoLead[] | null;
  accounts: DemoAccount[] | null;
  tasks?: DemoTask[] | null;
  deals?: DemoDeal[] | null;
  campaigns?: DemoCampaign[] | null;
  records: { rows: DemoRecord[]; searchableKeys: string[]; piiKeys: string[] } | null;
  pii: boolean;
  /** Reps see only their own leads. */
  ownOnly?: { uid: string } | null;
}
const maskName = (n: string) => n.split(" ").filter(Boolean).map((p) => `${p[0]}.`).join(" ");
const has = (s: unknown, q: string) => typeof s === "string" && s.toLowerCase().includes(q);

export function searchDemo(i: DemoInput): SearchHit[] {
  const q = i.q.toLowerCase();
  const out: SearchHit[] = [];
  const accName = new Map((i.accounts ?? []).map((a) => [a.id, a.name]));
  if (i.leads) {
    const own = i.ownOnly ? i.leads.filter((l) => l.ownerId === i.ownOnly!.uid) : i.leads;
    // Masked viewers match on the masked name and the firm only, never on the hidden full name.
    out.push(...own.filter((l) => (i.pii ? has(l.name, q) || has(l.title, q) : has(maskName(l.name), q)) || has(accName.get(l.accountId), q)).slice(0, HIT_LIMIT)
      .map((l): SearchHit => ({ key: `lead:${l.id}`, type: "lead", title: i.pii ? l.name : maskName(l.name), subtitle: [l.title, accName.get(l.accountId)].filter(Boolean).join(" · ") || undefined, href: `/leads/${l.id}`, masked: !i.pii })));
  }
  if (i.accounts) {
    out.push(...i.accounts.filter((a) => has(a.name, q) || has(a.city, q)).slice(0, HIT_LIMIT)
      .map((a): SearchHit => ({ key: `account:${a.id}`, type: "account", title: a.name, subtitle: [a.city, a.district].filter(Boolean).join(", ") || undefined, href: `/accounts/${a.id}` })));
  }
  const mine = <T extends { ownerId: string }>(rows: T[]) => (i.ownOnly ? rows.filter((r) => r.ownerId === i.ownOnly!.uid) : rows);
  if (i.tasks) {
    out.push(...mine(i.tasks).filter((t) => has(t.title, q)).slice(0, HIT_LIMIT).map((t): SearchHit => ({ key: `task:${t.id}`, type: "task", title: t.title, href: "/tasks" })));
  }
  if (i.deals) {
    out.push(...mine(i.deals).filter((d) => has(d.name, q)).slice(0, HIT_LIMIT).map((d): SearchHit => ({ key: `deal:${d.id}`, type: "deal", title: d.name, href: "/pipeline" })));
  }
  if (i.campaigns) {
    out.push(...i.campaigns.filter((c) => has(c.name, q) || has(c.utmCampaign, q)).slice(0, HIT_LIMIT)
      .map((c): SearchHit => ({ key: `campaign:${c.id}`, type: "campaign", title: c.name, subtitle: c.status, href: `/campaigns/${c.id}` })));
  }
  if (i.records) {
    const keys = i.records.searchableKeys.filter((k) => i.pii || !i.records!.piiKeys.includes(k));
    out.push(...i.records.rows.filter((r) => has(r.title, q) || keys.some((k) => has(r.data[k], q))).slice(0, HIT_LIMIT)
      .map((r): SearchHit => ({ key: `obj:${r.objectKey}:${r.id}`, type: "record", objectKey: r.objectKey, title: r.title, subtitle: r.label, href: `/o/${r.objectKey}/${r.id}` })));
  }
  return out;
}
