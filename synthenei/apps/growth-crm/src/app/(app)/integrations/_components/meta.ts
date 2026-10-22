// Connector reference facts from spec section 7.1 that the Integration row does not carry yet
// (direction, auth, our tables, real-world blockers, what we never store). Static product facts, not workspace data.
// Requested from BACKEND as columns on `integrations` / a provider catalogue; until then they live here.
import type { Integration } from "@/lib/data/types";
import { localize, type Vocab } from "@/lib/vertical";

export type Direction = "in" | "out" | "both";
export type Blocker = { label: string; who: "Client" | "Vendor" | "Us"; detail: string };
export interface ConnectorMeta {
  direction: Direction;
  /** Larger card on the grid: the sources the LAWSOME demo story depends on. */
  featured?: boolean;
  /** How the change arrives: concrete mechanism + cadence. */
  trigger: { kind: "Webhook" | "Poll" | "Webhook + poll" | "CSV" | "On event"; detail: string };
  auth: string;
  tables: string[];
  blockers: Blocker[];
  neverStore: string[];
  /** Short labels for the flow diagram: what their side is called and what our ingest step is. */
  flow: { source: string; ingest: string; outbound?: string };
  /** Plain-English line for the card, describing what moves. */
  value: string;
  csv?: boolean;
}

export const META: Record<string, ConnectorMeta> = {
  "zoho-crm": {
    direction: "both", featured: true, value: "Leads, accounts and deals in; stage, score and owner back to Zoho.",
    trigger: { kind: "Webhook + poll", detail: "Notification API watch channels, plus a 15-min poll for missed changes; outbound on our change" },
    auth: "OAuth 2.0 via accounts.zoho.in (India DC), api_domain from the token response",
    tables: ["leads", "contacts", "accounts", "deals", "activities", "integration_field_maps"],
    blockers: [
      { label: "Watch channels expire", who: "Us", detail: "Default 1 hour, max 1 week; a cron must renew them before expiry." },
      { label: "API credits by edition", who: "Client", detail: "Zoho edition sets the daily API credit limit; check it before choosing sync volume." },
      { label: "Conflict rules sign-off", who: "Client", detail: "Stage, value and owner are owned by the CRM; phone/email by last writer. Needs Sales Manager approval." },
    ],
    neverStore: ["Zoho-only custom fields outside the mapping (kept as external_data JSON)", "OAuth refresh token (vault only)"],
    flow: { source: "Zoho CRM", ingest: "ingest-zoho", outbound: "Out queue" },
  },
  hubspot: {
    direction: "both", value: "Contacts, companies and deals mirrored. Use instead of Zoho, never both.",
    trigger: { kind: "Webhook + poll", detail: "App subscriptions on create and property change, plus a 15-min poll" },
    auth: "OAuth 2.0 public app or private app token",
    tables: ["contacts", "accounts", "deals"],
    blockers: [
      { label: "One CRM sync per tenant", who: "Us", detail: "Zoho or HubSpot, not both, to avoid three-way conflicts." },
      { label: "Per-seat pricing", who: "Client", detail: "HubSpot seats are the client's cost." },
    ],
    neverStore: ["HubSpot tokens in the database"], flow: { source: "HubSpot", ingest: "ingest-hubspot", outbound: "Out queue" },
  },
  whatsapp: {
    direction: "both", featured: true, value: "Replies and read receipts in; approved Tamil and English templates out.",
    trigger: { kind: "Webhook", detail: "Cloud API webhooks for messages and statuses, verified with X-Hub-Signature-256" },
    auth: "System-user access token for the WhatsApp Business Account; webhook verify token",
    tables: ["conversations", "messages", "activities", "consent_log"],
    blockers: [
      { label: "Meta Business verification", who: "Client", detail: "The business must be verified in Meta Business Manager, and the display name approved." },
      { label: "Template approval", who: "Vendor", detail: "Each template (marketing, utility, authentication) is reviewed by Meta before it can be sent." },
      { label: "Per-message pricing", who: "Client", detail: "Charged per delivered template since 1 July 2025; marketing costs more than utility. Confirm current India rates before budgeting." },
      { label: "24-hour window and opt-in", who: "Us", detail: "Free-form replies only within 24 h of the lead's last message; templates need recorded WhatsApp consent." },
    ],
    neverStore: ["Message media files", "Access token (vault only)", "Numbers without a matching lead"],
    flow: { source: "WhatsApp Cloud API", ingest: "ingest-whatsapp", outbound: "Templates" },
  },
  linkedin: {
    direction: "in", featured: true, csv: true, value: "Lead Gen Form responses and campaign spend in. CSV bridge until API access is approved.",
    trigger: { kind: "Poll", detail: "Lead Sync API every 15 min; Advertising API daily. Today: daily CSV export from Campaign Manager" },
    auth: "OAuth 2.0 three-legged, member with an ad-account role",
    tables: ["leads", "lead_events", "campaign_daily_metrics"],
    blockers: [
      { label: "Partner approval", who: "Vendor", detail: "Lead Sync (r_marketing_leadgen_automation) and Advertising API access need LinkedIn approval. Not guaranteed, no published timeline." },
      { label: "Verified Company Page", who: "Client", detail: "The ad account must sit under a verified Company Page." },
      { label: "No Sales Navigator data", who: "Vendor", detail: "Sales Navigator contacts are not available through these APIs." },
    ],
    neverStore: ["Member profile data beyond the form answers", "Access token (vault only)"],
    flow: { source: "LinkedIn Campaign Manager", ingest: "CSV import (live)" },
  },
  "meta-ads": {
    direction: "both", value: "Instant-form leads and daily spend in; qualified-lead events out (later).",
    trigger: { kind: "Webhook + poll", detail: "leadgen Page webhook; daily Insights poll" },
    auth: "System-user token with ads_read and leads_retrieval; app review",
    tables: ["campaign_daily_metrics", "leads", "lead_events"],
    blockers: [
      { label: "Business verification + app review", who: "Vendor", detail: "Advanced access needs Meta app review." },
      { label: "Click id capture", who: "Us", detail: "Landing form must store fbclid / _fbc to send Conversions API events." },
    ],
    neverStore: ["Ad creative files"], flow: { source: "Meta Marketing API", ingest: "ingest-meta", outbound: "CAPI events" },
  },
  "google-ads": {
    direction: "both", value: "Cost and clicks per campaign in; demo-booked and won conversions out by GCLID.",
    trigger: { kind: "Poll", detail: "Daily GAQL report; offline conversion upload on stage change" },
    auth: "OAuth 2.0 plus developer token",
    tables: ["campaign_daily_metrics", "leads.click_ids"],
    blockers: [
      { label: "Developer token approval", who: "Vendor", detail: "Basic access needs Google approval." },
      { label: "GCLID capture", who: "Us", detail: "Landing form must capture gclid with consent." },
    ],
    neverStore: ["Search terms tied to a person"], flow: { source: "Google Ads API", ingest: "sync-google-ads", outbound: "Conversions" },
  },
  ga4: {
    direction: "both", featured: true, value: "Daily sessions, sources, pages and key events in; CRM conversions out (later).",
    trigger: { kind: "Poll", detail: "Daily runReport at 06:00 IST for the previous day" },
    auth: "Service account with Viewer on the property; Measurement Protocol secret for outbound",
    tables: ["ga4_daily"],
    blockers: [
      { label: "No GA4 property yet", who: "Client", detail: "The landing site needs a GA4 property before anything can sync." },
      { label: "Counts will differ", who: "Us", detail: "Consent-gated tracking means GA4 and CRM lead counts never match exactly (M23)." },
    ],
    neverStore: ["User-level or client-id data"], flow: { source: "GA4 Data API", ingest: "sync-ga4", outbound: "MP events" },
  },
  mailchimp: {
    direction: "in", featured: true, value: "Sends, opens, clicks and unsubscribes in; an unsubscribe withdraws marketing consent.",
    trigger: { kind: "Webhook + poll", detail: "Reports API daily at 06:30 IST; list webhooks for unsubscribe and cleaned" },
    auth: "API key or OAuth 2.0; data-centre prefix in the base URL",
    tables: ["campaigns", "campaign_daily_metrics", "consent_log"],
    blockers: [
      { label: "Email tool not chosen", who: "Client", detail: "Mailchimp stands in for whichever email tool the marketing lead picks." },
      { label: "Opens are polled", who: "Vendor", detail: "Opens and clicks come from reports, not webhooks; bot opens filtered with filter_bots." },
    ],
    neverStore: ["Email body content", "API key in the database"], flow: { source: "Mailchimp Marketing API", ingest: "sync-mailchimp" },
  },
  gmail: {
    direction: "both", value: "Threads with known leads logged as activities; reply from the CRM (later).",
    trigger: { kind: "Webhook", detail: "Gmail push via Pub/Sub watch" },
    auth: "OAuth 2.0 per user",
    tables: ["conversations", "messages", "activities"],
    blockers: [{ label: "Restricted scopes", who: "Vendor", detail: "Gmail read scopes need Google verification and a third-party security assessment for public apps." }],
    neverStore: ["Mail with unknown senders", "Attachments"], flow: { source: "Gmail API", ingest: "ingest-gmail", outbound: "Send as rep" },
  },
  outlook: {
    direction: "both", value: "Same as Gmail, for firms on Microsoft 365 mailboxes.",
    trigger: { kind: "Webhook", detail: "Microsoft Graph change notifications" },
    auth: "OAuth 2.0 per user; tenant admin consent",
    tables: ["conversations", "messages", "activities"],
    blockers: [{ label: "Admin consent", who: "Client", detail: "The firm's Microsoft 365 admin must consent once per tenant." }],
    neverStore: ["Mail with unknown senders", "Attachments"], flow: { source: "Microsoft Graph", ingest: "ingest-outlook", outbound: "Send as rep" },
  },
  calendly: {
    direction: "in", value: "Demo bookings and cancellations in; the deal moves to Demo scheduled.",
    trigger: { kind: "Webhook", detail: "invitee.created and invitee.canceled" },
    auth: "OAuth or personal access token",
    tables: ["activities", "tasks", "deals", "lead_events"],
    blockers: [
      { label: "Paid plan for webhooks", who: "Client", detail: "Calendly webhooks need a paid plan." },
      { label: "Booking tool not chosen", who: "Client", detail: "Calendly or Cal.com, decided with the client (A4)." },
    ],
    neverStore: ["Calendar entries unrelated to demos"], flow: { source: "Calendly", ingest: "ingest-calendly" },
  },
  "cal-com": {
    direction: "in", value: "Open-source booking alternative; same demo-booked flow.",
    trigger: { kind: "Webhook", detail: "BOOKING_CREATED and BOOKING_CANCELLED" },
    auth: "API key; self-hostable",
    tables: ["activities", "tasks", "deals", "lead_events"],
    blockers: [{ label: "Booking tool not chosen", who: "Client", detail: "Calendly or Cal.com, decided with the client (A4)." }],
    neverStore: ["Calendar entries unrelated to demos"], flow: { source: "Cal.com", ingest: "ingest-calcom" },
  },
  slack: {
    direction: "out", value: "Alerts out: hot lead, SLA breach, deal won, sync failure, backup alert.",
    trigger: { kind: "On event", detail: "Database trigger to queue to Edge Function" },
    auth: "Incoming webhook URL or bot token with chat:write",
    tables: ["reads leads", "reads deals", "reads backup_checks"],
    blockers: [{ label: "Channel names and content", who: "Client", detail: "Agree channels; messages carry name, firm and a link only, never phone or email." }],
    neverStore: ["Slack message history"], flow: { source: "Slack", ingest: "notify-slack", outbound: "Channel post" },
  },
  zapier: {
    direction: "both", value: "Signed events out (lead created, stage changed, won); create-lead in.",
    trigger: { kind: "Webhook", detail: "Our HMAC-SHA256 signed webhooks out; catch endpoint in" },
    auth: "Per-tenant signing secret; inbound token",
    tables: ["leads", "deals"],
    blockers: [{ label: "Rate limit", who: "Us", detail: "Inbound capped at 60 requests per minute per tenant." }],
    neverStore: ["Zap payloads beyond the mapped fields"], flow: { source: "Zapier", ingest: "ingest-hook", outbound: "Signed hook" },
  },
  make: {
    direction: "both", value: "Same signed webhooks as Zapier, for Make scenarios.",
    trigger: { kind: "Webhook", detail: "Our HMAC-SHA256 signed webhooks out; catch endpoint in" },
    auth: "Per-tenant signing secret; inbound token",
    tables: ["leads", "deals"],
    blockers: [{ label: "Rate limit", who: "Us", detail: "Inbound capped at 60 requests per minute per tenant." }],
    neverStore: ["Scenario payloads beyond the mapped fields"], flow: { source: "Make", ingest: "ingest-hook", outbound: "Signed hook" },
  },
  razorpay: {
    direction: "in", value: "Captured payments and subscription charges in; sets customer status on the account.",
    trigger: { kind: "Webhook", detail: "payment.captured, subscription.charged, invoice.paid, payment.failed" },
    auth: "Key id and secret; X-Razorpay-Signature HMAC-SHA256",
    tables: ["deals", "accounts.customer_status", "payments (later)"],
    blockers: [{ label: "Only if billed via Razorpay", who: "Client", detail: "Relevant only if LAWSOME bills customers through Razorpay." }],
    neverStore: ["Card or bank details (amounts and ids only)"], flow: { source: "Razorpay", ingest: "ingest-razorpay" },
  },
};

const FALLBACK: ConnectorMeta = {
  direction: "in", value: "", trigger: { kind: "Webhook", detail: "" }, auth: "Not documented yet", tables: [], blockers: [], neverStore: [],
  flow: { source: "Provider", ingest: "Edge Function" },
};
const baseMeta = (i: Integration): ConnectorMeta => META[i.id] ?? { ...FALLBACK, value: i.summary, flow: { source: i.name, ingest: "Edge Function" } };
/** Connector facts, worded for the active vertical (legal unchanged). */
export const metaFor = (i: Integration, v?: Vocab): ConnectorMeta => {
  const m = baseMeta(i);
  if (!v || !v.rw.length) return m;
  const L = (x: string) => localize(v, x);
  return { ...m, value: L(m.value), trigger: { ...m.trigger, detail: L(m.trigger.detail) }, blockers: m.blockers.map((b) => ({ ...b, detail: L(b.detail), label: L(b.label) })), neverStore: m.neverStore.map(L) };
};

export const CATEGORIES = ["CRM", "Messaging", "Email", "Ads", "Analytics", "Scheduling", "Payments", "Automation"] as const;

/** Honest labels. In MVP nothing is live; "Connected (demo)" exists only for completeness of the enum. */
export function statusLabel(i: Integration): { status: "showcase" | "connected" | "needs_attention" | "error" | "not_configured"; label: string } {
  switch (i.status) {
    case "showcase": return { status: "showcase", label: i.sampleFeed ? "Showcase · sample data" : "Showcase" };
    case "connected": return { status: "connected", label: "Connected (demo)" };
    case "needs_attention": return { status: "needs_attention", label: "Needs attention" };
    case "error": return { status: "error", label: "Error" };
    default: return { status: "not_configured", label: "Not connected" };
  }
}
export const STATUS_ORDER: Record<Integration["status"], number> = { connected: 0, error: 1, needs_attention: 2, showcase: 3, not_configured: 4 };
