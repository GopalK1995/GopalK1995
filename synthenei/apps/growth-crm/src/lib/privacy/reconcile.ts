// Reconciliation of the denormalised lead consent flags against consent_log (PRIV-015). Pure: the same rule the 0032 trigger applies, so a
// test (and an admin report) can prove the flags equal "what the newest row for each purpose says". A purpose with no row is not compared.
import { LEAD_CONSENT_FLAG, type ConsentPurpose } from "./types";

export interface LogRow { leadId: string; purpose: ConsentPurpose; action: string; occurredAt: string; id?: number }
export type Flags = Partial<Record<"consent_demo_followup" | "consent_whatsapp" | "consent_marketing", boolean>>;
export interface Mismatch { leadId: string; flag: keyof Flags; stored: boolean; expected: boolean }

/** Newest row per (lead, purpose) wins (ties by id); granted = true, withdrawn and erasure_completed = false; other actions change nothing. */
export function expectedFlags(rows: LogRow[]): Map<string, Flags> {
  const newest = new Map<string, LogRow>();
  for (const r of rows) {
    if (!LEAD_CONSENT_FLAG[r.purpose]) continue;
    const k = `${r.leadId}|${r.purpose}`, cur = newest.get(k);
    if (!cur || r.occurredAt > cur.occurredAt || (r.occurredAt === cur.occurredAt && (r.id ?? 0) > (cur.id ?? 0))) newest.set(k, r);
  }
  const out = new Map<string, Flags>();
  for (const r of newest.values()) {
    if (r.action !== "granted" && r.action !== "withdrawn" && r.action !== "erasure_completed") continue;
    const f = LEAD_CONSENT_FLAG[r.purpose]!;
    out.set(r.leadId, { ...(out.get(r.leadId) ?? {}), [f]: r.action === "granted" });
  }
  return out;
}

export function flagMismatches(leads: { id: string; flags: Flags }[], rows: LogRow[]): Mismatch[] {
  const want = expectedFlags(rows), out: Mismatch[] = [];
  for (const l of leads) {
    const e = want.get(l.id);
    if (!e) continue;
    for (const k of Object.keys(e) as (keyof Flags)[]) if ((l.flags[k] ?? false) !== e[k]) out.push({ leadId: l.id, flag: k, stored: l.flags[k] ?? false, expected: e[k] as boolean });
  }
  return out;
}
