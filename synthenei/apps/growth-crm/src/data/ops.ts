// SYNTHETIC operational data: GA4 sample, integrations, tasks, consent, users.
import type { ConsentEntry, Integration, PrivacyRequest, StaffUser, SyncRun, Task } from "./types";
import { leads, NOW_ISO } from "./leads";

const D = 86400e3, H = 3600e3;
const now = new Date(NOW_ISO).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

// ---- GA4 (MOCK sample shaped like ga4_daily after a runReport pull) ----
function seeded(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
const r = seeded(7);
export const GA4_CHANNELS = ["Paid Social", "Email", "Organic Search", "Direct", "Referral"] as const;
const base: Record<(typeof GA4_CHANNELS)[number], number> = { "Paid Social": 95, Email: 34, "Organic Search": 22, Direct: 20, Referral: 6 };
const engagement: Record<(typeof GA4_CHANNELS)[number], number> = { "Paid Social": 0.46, Email: 0.71, "Organic Search": 0.6, Direct: 0.55, Referral: 0.64 };
export const ga4Daily = Array.from({ length: 30 }, (_, i) => {
  const day = iso(now - (29 - i) * D).slice(0, 10);
  const rows = GA4_CHANNELS.map((ch) => {
    const sessions = Math.round(base[ch] * (0.7 + r() * 0.7) * (i > 24 ? 1.15 : 1));
    return { channel: ch, sessions, engaged: Math.round(sessions * (engagement[ch] + (r() - 0.5) * 0.08)), users: Math.round(sessions * 0.84) };
  });
  return { day, rows, sessions: rows.reduce((a, x) => a + x.sessions, 0), users: rows.reduce((a, x) => a + x.users, 0), engaged: rows.reduce((a, x) => a + x.engaged, 0) };
});
export const ga4Totals = (() => {
  const sessions = ga4Daily.reduce((a, d) => a + d.sessions, 0), engaged = ga4Daily.reduce((a, d) => a + d.engaged, 0), users = ga4Daily.reduce((a, d) => a + d.users, 0);
  return { sessions, engaged, users, avgEngagementSecs: 71 };
})();
export const ga4ByChannel = GA4_CHANNELS.map((ch) => {
  const sessions = ga4Daily.reduce((a, d) => a + d.rows.find((x) => x.channel === ch)!.sessions, 0);
  const engaged = ga4Daily.reduce((a, d) => a + d.rows.find((x) => x.channel === ch)!.engaged, 0);
  return { channel: ch, sessions, engaged };
});
export const ga4Pages = [
  { path: "/", sessions: Math.round(ga4Totals.sessions * 0.82), engagedPct: 0.54 },
  { path: "/privacy", sessions: Math.round(ga4Totals.sessions * 0.03), engagedPct: 0.31 },
].filter((p) => p.sessions > 0);
export const ga4Devices = [{ label: "Mobile", share: 0.58 }, { label: "Desktop", share: 0.39 }, { label: "Tablet", share: 0.03 }];
export const ga4Geo = [
  { label: "Tamil Nadu", share: 0.41 }, { label: "Karnataka", share: 0.14 }, { label: "Maharashtra", share: 0.1 },
  { label: "Telangana", share: 0.09 }, { label: "Delhi", share: 0.08 }, { label: "Kerala", share: 0.06 }, { label: "Other / unknown", share: 0.12 },
];
// GA4 'key events' for form_submit in the same period (intentionally differs from CRM count: ad blockers, consent gating)
export const ga4KeyEventsFormSubmit = Math.round(leads.length * 1.18);
// Share of visitors who accept cookies in the landing app's consent banner (assumption for the mock)
export const CONSENT_ACCEPT_RATE = 0.65;

// ---- tasks (SLA: first response within 4h) ----
export const SLA_MINUTES = 240;
export const tasks: Task[] = leads
  .filter((l) => ["new", "contacted", "demo_booked", "demo_done"].includes(l.stage))
  .slice(0, 14)
  .map((l, i): Task => {
    const kind = l.stage === "new" ? "first_response" : l.stage === "contacted" ? "follow_up" : l.stage === "demo_booked" ? "demo_prep" : "follow_up";
    const title = { first_response: "Send first response", follow_up: "Follow up after demo or first contact", demo_prep: "Prepare tailored demo" }[kind] as string;
    const offsetH = [-30, -6, -2, 1, 3, 5, 20, 26, 30, 48, 72, 96, -50, 8][i % 14];
    return { id: `T-${100 + i}`, leadId: l.id, title, kind, assignee: l.owner, dueAt: iso(now + offsetH * H), status: i === 3 ? "done" : "open" };
  });

// ---- integrations (honest: nothing is connected in this scaffold) ----
export const integrations: Integration[] = [
  { key: "ga4", label: "Google Analytics 4", status: "mock", lastSyncAt: null, rowsIn: null, howTo: "Needs GA4 property id + service account with Viewer access; daily Data API runReport job.", honestNote: "Showing a synthetic sample shaped like the real pull. Not connected." },
  { key: "linkedin", label: "LinkedIn Ads", status: "mock", lastSyncAt: iso(now - 2 * D), rowsIn: 60, howTo: "Upload the Campaign Manager CSV export. Real API needs Lead Sync/Advertising API partner approval, which is not guaranteed.", honestNote: "MOCK / CSV import. No LinkedIn API connection exists. Real API sits behind FEATURE_LINKEDIN_REAL_API." },
  { key: "meta", label: "Meta Ads", status: "csv_only", lastSyncAt: iso(now - 1 * D), rowsIn: 54, howTo: "Upload Ads Manager CSV export (daily breakdown). Marketing API later.", honestNote: "CSV only (sample rows). Not connected to Meta." },
  { key: "email", label: "Email provider", status: "not_configured", lastSyncAt: null, rowsIn: null, howTo: "Tool not decided (open question). Import campaign CSV or add a webhook for sends/opens/clicks.", honestNote: "Which email tool Venket uses is unknown." },
  { key: "whatsapp", label: "WhatsApp Business", status: "not_configured", lastSyncAt: null, rowsIn: null, howTo: "Cloud API via a provider after business verification. MVP: log WhatsApp contact manually on the lead.", honestNote: "Not integrated. Template messages are per-message billed by Meta." },
  { key: "webhook", label: "Lead webhook (landing page)", status: "not_configured", lastSyncAt: null, rowsIn: null, howTo: "Point lawsome-landing LEAD_WEBHOOK_URL / Supabase insert at this CRM's ingest route.", honestNote: "Contract exists in the landing app; ingest route not built yet." },
  { key: "supabase", label: "Supabase (database)", status: "not_configured", lastSyncAt: null, rowsIn: null, howTo: "Create project, apply supabase/schema.sql, set env vars.", honestNote: "No project exists yet. Screens read synthetic data from src/data/." },
];
export const syncRuns: SyncRun[] = [
  { id: 3, integration: "linkedin", startedAt: iso(now - 2 * D), status: "partial", rowsIn: 60, rowsRejected: 2, note: "Sample CSV import, 2 rows missing campaign name (synthetic)" },
  { id: 2, integration: "meta", startedAt: iso(now - 1 * D), status: "success", rowsIn: 54, rowsRejected: 0, note: "Sample CSV import (synthetic)" },
  { id: 1, integration: "ga4", startedAt: iso(now - 1 * D - 3 * H), status: "failed", rowsIn: 0, rowsRejected: 0, note: "Example failure state: property access not granted (synthetic)" },
];

// ---- consent & privacy ----
export const consentLog: ConsentEntry[] = leads.slice(0, 40).flatMap((l, i): ConsentEntry[] => {
  const out: ConsentEntry[] = [{ id: i * 3 + 1, leadId: l.id, purpose: "demo_followup", action: "granted", noticeVersion: "2026-10-v1", via: "landing_form", at: l.createdAt }];
  if (l.consent.marketingEmail) out.push({ id: i * 3 + 2, leadId: l.id, purpose: "marketing_email", action: "granted", noticeVersion: "2026-10-v1", via: "landing_form", at: l.createdAt });
  return out;
});
export const privacyRequests: PrivacyRequest[] = [
  { id: "PR-1", kind: "withdrawal", leadId: leads[9].id, receivedOn: iso(now - 3 * D).slice(0, 10), dueOn: iso(now + 27 * D).slice(0, 10), status: "open" },
  { id: "PR-2", kind: "erasure", leadId: leads[22].id, receivedOn: iso(now - 12 * D).slice(0, 10), dueOn: iso(now + 18 * D).slice(0, 10), status: "open" },
  { id: "PR-3", kind: "erasure", leadId: leads[41].id, receivedOn: iso(now - 25 * D).slice(0, 10), dueOn: iso(now + 5 * D).slice(0, 10), status: "done" },
];
export const staff: StaffUser[] = [
  { name: "Krishna", role: "admin", focus: "Builds platform, integrations, backups" },
  { name: "Venket", role: "marketer", focus: "Campaigns, content, lead follow-up" },
  { name: "Shaun", role: "viewer", focus: "Project coordination" },
  { name: "Kiruba", role: "viewer", focus: "Research / lead sources" },
  { name: "Ashique", role: "viewer", focus: "Sales conversations" },
];
