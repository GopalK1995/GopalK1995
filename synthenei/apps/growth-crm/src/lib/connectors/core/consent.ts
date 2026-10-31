// Consent enforcement hook: an outbound marketing push only reaches contacts that pass public.can_contact().
// Fails closed: a check that throws propagates (the job retries, nothing is sent).
import type { ConnectorStore } from "./ports";
import type { ConsentPurpose } from "./types";

export interface ConsentSplit { allowed: string[]; skipped: string[] }

export async function filterByConsent(store: Pick<ConnectorStore, "canContact">, leadIds: string[], purpose: ConsentPurpose | undefined): Promise<ConsentSplit> {
  if (!purpose) return { allowed: [...leadIds], skipped: [] };
  const allowed: string[] = [], skipped: string[] = [];
  for (const id of leadIds) ((await store.canContact(id, purpose)) ? allowed : skipped).push(id);
  return { allowed, skipped };
}
