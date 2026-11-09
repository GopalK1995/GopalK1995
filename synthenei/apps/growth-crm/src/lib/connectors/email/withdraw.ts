// Applying a "no more email" decision: shared by the unsubscribe page, the one-click endpoint, provider complaints/bounces and the
// Mailchimp pull. Withdrawal writes consent_log (so can_contact blocks every later send, including queued ones) AND the suppression list.
// Idempotent: repeating it adds nothing new.
import { createHash } from "node:crypto";
import { normaliseEmail, withdrawsConsent, type SuppressionReason } from "./suppression";
import type { EmailStore } from "./store";

export const subjectRefOf = (email: string): string => createHash("sha256").update(normaliseEmail(email)).digest("hex");

export interface WithdrawInput { tenantId: string; workspaceId: string; email: string; reason: SuppressionReason; source: string; leadIds?: string[] }
export interface WithdrawResult { suppressed: boolean; consentWritten: number; leads: number }

export async function suppressAddress(store: EmailStore, i: WithdrawInput): Promise<WithdrawResult> {
  const email = normaliseEmail(i.email);
  const leads = i.leadIds?.length ? i.leadIds : await store.findLeadsByEmail(i.workspaceId, email);
  const added = await store.addSuppression({ tenantId: i.tenantId, workspaceId: i.workspaceId, email, reason: i.reason, source: i.source, leadId: leads[0] ?? null });
  let written = 0;
  if (withdrawsConsent(i.reason)) {
    const note = i.reason === "unsubscribe" ? `Unsubscribed (${i.source})` : `Spam complaint (${i.source})`;
    const targets: (string | null)[] = leads.length ? leads : [null];   // no lead yet: the hashed address still records the withdrawal
    for (const leadId of targets) {
      if (leadId ? (await store.latestConsent(leadId)) === "withdrawn" : !added) continue;   // replays write nothing new
      await store.recordConsent({ tenantId: i.tenantId, workspaceId: i.workspaceId, leadId, subjectRef: subjectRefOf(email), action: "withdrawn", note });
      written++;
    }
  }
  if (added || written) {
    await store.audit({ workspaceId: i.workspaceId, action: `email.${i.reason}`, summary: `Email address suppressed: ${i.reason.replace("_", " ")}`, objectId: subjectRefOf(email).slice(0, 16), detail: { source: i.source, leads: leads.length } }).catch(() => undefined);
    // Events carry a uuid object: only a known lead can be named (the address itself is never put on the bus).
    if (leads[0]) await store.emit({ type: i.reason === "unsubscribe" ? "email.unsubscribed" : i.reason === "complaint" ? "email.complained" : i.reason === "hard_bounce" ? "email.bounced" : "email.suppressed", workspaceId: i.workspaceId, objectType: "lead", objectId: leads[0], data: { reason: i.reason, source: i.source } });
  }
  return { suppressed: added, consentWritten: written, leads: leads.length };
}
