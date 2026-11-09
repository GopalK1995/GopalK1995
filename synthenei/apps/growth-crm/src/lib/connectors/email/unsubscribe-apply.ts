// Applies a verified unsubscribe token: writes the consent withdrawal (consent_log, purpose marketing_email) and the suppression row.
// Used by the unsubscribe page, the RFC 8058 one-click endpoint and nothing else. Idempotent. A token proves "this link was sent to this
// lead"; it grants nothing but the right to opt out of that workspace's email.
import { createHash } from "node:crypto";
import type { EmailStore } from "./store";
import { verifyUnsubscribe, type UnsubPayload } from "./unsubscribe";
import { suppressAddress } from "./withdraw";

export type UnsubOutcome = { status: "done" } | { status: "invalid" | "expired" };
export type UnsubPreview = { status: "ready"; payload: UnsubPayload } | { status: "invalid" | "expired" };

/** Checks a token without writing anything (what the confirmation page does on GET: mail scanners prefetch links). */
export function previewUnsubscribe(token: string, secret: string, nowMs: number): UnsubPreview {
  const v = verifyUnsubscribe(token, secret, nowMs);
  return v.ok ? { status: "ready", payload: v.value } : { status: v.reason === "expired" ? "expired" : "invalid" };
}

export async function applyUnsubscribe(store: EmailStore, token: string, secret: string, nowMs: number): Promise<UnsubOutcome> {
  const p = previewUnsubscribe(token, secret, nowMs);
  if (p.status !== "ready") return { status: p.status };
  const { t: tenantId, w: workspaceId, l: leadId } = p.payload;
  const rcpt = leadId ? await store.getRecipient(workspaceId, leadId) : null;
  if (rcpt?.email) {
    await suppressAddress(store, { tenantId, workspaceId, email: rcpt.email, reason: "unsubscribe", source: "unsubscribe_link", leadIds: [leadId!] });
  } else if (leadId && rcpt) {
    // The lead is in this workspace but has no address any more (erased): still record the withdrawal so can_contact stays false.
    // A lead that is not in the token's workspace is never touched.
    if ((await store.latestConsent(leadId)) !== "withdrawn") {
      await store.recordConsent({ tenantId, workspaceId, leadId, subjectRef: createHash("sha256").update(`lead:${leadId}`).digest("hex"), action: "withdrawn", note: "Unsubscribed (unsubscribe_link)" });
    }
  }
  return { status: "done" };
}
