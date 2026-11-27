// Consent capture by a team member (phone, in person, paper form, import): one append-only consent_log row plus the lead's denormalised
// flag. The row names the notice version the person saw, so a later notice change never rewrites what they agreed to. Runs on the
// signed-in user's client (RLS: workspace member inserts, lead must be visible). Withdrawals made by the person themselves go through the
// public request form instead (intake.ts).
import type { Db } from "@/lib/db/client";
import { from } from "@/lib/db/query";
import { throwIfError } from "@/lib/db/errors";
import { subjectRefOf } from "./subject";
import { insertConsentRows } from "./consent-write";
import { evidenceColumns, type ConsentEvidence } from "./evidence";
import { LEAD_CONSENT_FLAG, type ConsentPurpose } from "./types";

type R = Record<string, unknown>;
export const CAPTURE_CHANNELS = ["manual", "import", "whatsapp_optin", "landing_form"] as const;
export type CaptureChannel = (typeof CAPTURE_CHANNELS)[number];
/** Evidence the caller can supply. formId defaults to "crm:<channel>"; a team member's own address is never the person's, so no ip hash here. */
export interface CaptureInput { leadId: string; purpose: ConsentPurpose; action: "granted" | "withdrawn"; via: CaptureChannel; noticeVersion: string; note?: string; evidence?: Partial<Pick<ConsentEvidence, "noticeSha256" | "formId">> }

export function consentRow(i: CaptureInput & { workspaceId: string; subjectRef: string; recordedBy: string }): R {
  return {
    workspace_id: i.workspaceId, lead_id: i.leadId, subject_ref: i.subjectRef, purpose: i.purpose, action: i.action,
    notice_version: i.noticeVersion.slice(0, 40), captured_via: i.via, recorded_by: i.recordedBy, note: i.note ? i.note.slice(0, 300) : null,
    ...evidenceColumns({ noticeSha256: i.evidence?.noticeSha256 ?? null, formId: i.evidence?.formId ?? `crm:${i.via}`, ipHash: null, uaClass: null }),
  };
}

export async function captureConsent(db: Db, workspaceId: string, recordedBy: string, i: CaptureInput): Promise<void> {
  const l = await from(db, "leads").select("id, email").eq("id", i.leadId).eq("workspace_id", workspaceId).is("deleted_at", null).maybeSingle();
  throwIfError(l.error);
  const lead = l.data as R | null;
  if (!lead) throw new Error("lead not found");
  // No address, no stable subject: fall back to the lead id so the log still groups the person's entries.
  const subjectRef = typeof lead.email === "string" && lead.email ? subjectRefOf(lead.email) : subjectRefOf(`lead:${i.leadId}`);
  const ins = await insertConsentRows(db, [consentRow({ ...i, workspaceId, subjectRef, recordedBy })], { select: true });
  throwIfError(ins.error);
  const flag = LEAD_CONSENT_FLAG[i.purpose];
  if (flag) {
    const u = await from(db, "leads").update({ [flag]: i.action === "granted" }).eq("id", i.leadId).eq("workspace_id", workspaceId).select("id");
    throwIfError(u.error);
  }
}
