// Shared types for the DPDP module (T052). Pure: safe in server and client bundles.
export const REQUEST_KINDS = ["access", "correction", "erasure", "withdrawal", "grievance"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export const REQUEST_STATUSES = ["received", "in_progress", "completed", "rejected"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const isRequestKind = (v: unknown): v is RequestKind => typeof v === "string" && (REQUEST_KINDS as readonly string[]).includes(v);

/** Matches the Postgres enum public.consent_purpose. */
export const CONSENT_PURPOSES = ["demo_followup", "marketing_email", "whatsapp", "analytics_cookies", "ai_processing"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const isPurpose = (v: unknown): v is ConsentPurpose => typeof v === "string" && (CONSENT_PURPOSES as readonly string[]).includes(v);
/** Denormalised consent flags on leads (0001). Purposes without a flag only appear in consent_log. */
export const LEAD_CONSENT_FLAG: Partial<Record<ConsentPurpose, "consent_demo_followup" | "consent_whatsapp" | "consent_marketing">> = {
  demo_followup: "consent_demo_followup", whatsapp: "consent_whatsapp", marketing_email: "consent_marketing",
};

export interface PrivacyRequest {
  id: string; workspaceId: string; subjectRef: string; leadId: string | null; kind: RequestKind;
  receivedAt: string; dueAt: string; status: RequestStatus; handledBy: string | null; exportPath: string | null;
  notes: string | null; completedAt: string | null;
}

/** tenant_config.config.privacy. Every field optional: defaults come from the generic wording in messages/en/privacy.json. */
export interface NoticeConfig {
  noticeVersion?: string; effectiveDate?: string; orgName?: string; intro?: string;
  purposes?: { key: string; label: string; text: string }[];
  collects?: string; sharing?: string; retention?: string; transfers?: string;
  grievance?: { name?: string; email?: string; hours?: string };
  extraSections?: { heading: string; body: string }[];
}

/** What the public pages know about a workspace. Resolved from rows and tenant config, never from code. */
export interface PublicWorkspace {
  wsUuid: string; wsSlug: string; tenantUuid: string; orgName: string; supportEmail: string | null;
  responseDays: number; dataRegion: string; dpo: { name?: string; email?: string; phone?: string } | null;
  notice: NoticeConfig;
}
