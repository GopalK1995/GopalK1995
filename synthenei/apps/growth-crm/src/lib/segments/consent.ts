// Consent gate for marketing pushes and exports: a contact is included only when public.can_contact(lead, purpose) is true
// (latest consent_log entry is a grant, lead not deleted, caller can see the lead's workspace). The UI shows this count next
// to the total and never merges them.
import type { Db } from "@/lib/db/client";
import { throwIfError } from "@/lib/db/errors";

export type ConsentPurpose = "marketing_email" | "whatsapp";
export const CONSENT_CAP = 2000;
export type CanContact = (leadId: string, purpose: ConsentPurpose) => Promise<boolean>;

/** WhatsApp campaigns need the whatsapp grant; everything else (email, ad-platform custom audiences) needs marketing_email. */
export const purposeFor = (channel: string | null | undefined): ConsentPurpose => (channel === "whatsapp" ? "whatsapp" : "marketing_email");

export const rpcCanContact = (db: Db): CanContact => async (leadId, purpose) => {
  const { data, error } = await (db as unknown as { rpc(fn: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> })
    .rpc("can_contact", { p_lead: leadId, p_purpose: purpose });
  throwIfError(error);
  return data === true;
};

/** Evaluates the gate for each id with bounded concurrency. Errors propagate (a failed check never counts as consent). */
export async function consentedIds(ids: string[], purpose: ConsentPurpose, canContact: CanContact, concurrency = 8): Promise<string[]> {
  const out: boolean[] = new Array(ids.length).fill(false);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= ids.length) return;
      out[i] = await canContact(ids[i], purpose);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return ids.filter((_, i) => out[i]);
}

export interface SegmentSize { total: number; consented: number; checked: number; partial: boolean; purpose: ConsentPurpose }
export function summarize(total: number, ids: string[], truncated: boolean, consented: string[], purpose: ConsentPurpose): SegmentSize {
  return { total, consented: consented.length, checked: ids.length, partial: truncated, purpose };
}
