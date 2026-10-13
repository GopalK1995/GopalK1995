// Shared types. Mirror supabase/schema.sql (snake_case there, camelCase here).
export type Stage = "new" | "contacted" | "demo_booked" | "demo_done" | "proposal" | "won" | "lost";
export type Channel = "email" | "linkedin" | "meta" | "organic" | "direct" | "referral";
// Event names for the landing page come from lawsome-landing/src/lib/track.ts; the rest are CRM-side events.
export type LandingEvent = "page_view" | "cta_click" | "form_start" | "form_submit" | "demo_booked" | "tour_play";
export type CrmEvent = "demo_done" | "stage_changed" | "email_sent" | "call_logged" | "whatsapp_logged" | "note";
export type EventName = LandingEvent | CrmEvent;

export interface LeadEvent { name: EventName; at: string; note?: string }
export interface Lead {
  id: string; name: string; email: string; organisation: string; role: string;
  firmSize: string | null; city: string; state: string; practiceArea: string | null;
  personalEmail: boolean; stage: Stage; maxStageIdx: number; owner: string;
  campaignId: string | null;
  firstTouch: { channel: Channel; campaign: string | null };
  lastTouch: { channel: Channel; campaign: string | null };
  createdAt: string; firstResponseAt: string | null;
  consent: { demoFollowup: boolean; marketingEmail: boolean };
  score: number; scoreParts: { label: string; pts: number }[];
  aiSummary: string; events: LeadEvent[];
}
export interface Campaign {
  id: string; name: string; channel: Channel; utmCampaign: string; audience: string;
  status: "live" | "ended"; startedOn: string;
  spend: number; impressions: number; reach: number; clicks: number; platformLeads: number;
  dataSource: "csv" | "mock" | "manual";
}
export interface Task { id: string; leadId: string; title: string; kind: string; assignee: string; dueAt: string; status: "open" | "done" }
export type IntegrationStatus = "connected" | "mock" | "csv_only" | "error" | "not_configured";
export interface Integration { key: string; label: string; status: IntegrationStatus; lastSyncAt: string | null; rowsIn: number | null; howTo: string; honestNote: string }
export interface SyncRun { id: number; integration: string; startedAt: string; status: "success" | "partial" | "failed"; rowsIn: number; rowsRejected: number; note: string }
export interface ConsentEntry { id: number; leadId: string; purpose: string; action: string; noticeVersion: string; via: string; at: string }
export interface PrivacyRequest { id: string; kind: "withdrawal" | "erasure"; leadId: string; receivedOn: string; dueOn: string; status: "open" | "done" }
export interface StaffUser { name: string; role: "admin" | "marketer" | "viewer"; focus: string }
