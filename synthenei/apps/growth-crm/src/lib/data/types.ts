// Domain types for the Growth CRM. camelCase here; supabase/schema.sql uses snake_case.
// Metric IDs (M1..M63) refer to synthenei/03-projects/growth-crm/03-product-spec.md section 6.

export type Role = "owner" | "sales_manager" | "sales_rep" | "marketing" | "data" | "viewer";

export type Channel = "linkedin" | "whatsapp" | "email" | "meta" | "google_ads" | "organic" | "referral" | "event";
export type LeadStatus = "new" | "contacted" | "qualified" | "nurturing" | "disqualified" | "converted";
export type LeadStage = "new" | "contacted" | "qualified" | "demo_booked" | "demo_done" | "proposal" | "won" | "lost";
export type DealStage = "discovery" | "demo_scheduled" | "demo_done" | "proposal" | "negotiation" | "won" | "lost";
export type City = string; // Tamil Nadu, Kerala, … per workspace
export type PracticeArea = "Civil" | "Criminal" | "Family" | "Property" | "Corporate" | "Labour" | "Tax";
export type FirmSize = "Solo" | "2–5" | "6–20" | "21–50" | "50+";
/** Hospitality vertical (dataset "wg"). Trip types shown as Account.interests / StayInfo.tripType. */
export type TripType = "Couples" | "Family" | "Friends group" | "Workation" | "Wedding & events" | "Corporate retreat" | "Trekking";
/** Hospitality: kind of guest/partner account. */
export type GuestKind = "family" | "travel_agent" | "corporate" | "wedding_planner";
/** Hospitality: stay specifics on an enquiry (Lead) or booking (Deal). `origin` = how the guest found the property. */
export interface StayInfo {
  checkIn: string; /* YYYY-MM-DD */ nights: number; guests: number; rooms: number; room: string; tripType: TripType | string;
  origin: "new" | "repeat" | "referral"; occasion?: string; flexibleDates?: boolean;
}
export interface BookingStay extends StayInfo {
  ratePerNight: number; /* INR, blended */ advancePct: number; advancePaid: number; /* INR */ viaOta: boolean; /* true = Booking.com / MakeMyTrip / agent commission */ commissionPct: number;
  status: "enquiry" | "hold" | "confirmed" | "checked_in" | "completed" | "cancelled";
}

export interface TeamMember {
  id: string; name: string; role: Role; title: string; email: string;
  monthlyTarget: number; // INR, closed-won new ARR
}

export interface Account {
  id: string; name: string; city: City; locality: string; district: string;
  courts: string[]; practiceAreas: PracticeArea[]; size: FirmSize; lawyers: number;
  founded: number; website: string; ownerId: string;
  status: "prospect" | "trial" | "customer" | "churned";
  icpTier: "A" | "B" | "C"; arr: number; lastActivityAt: string;
  /** Hospitality (wg) only. practiceAreas/courts are [] there; size reuses FirmSize as party size: Solo=1-2, 2–5=3-5, 6–20=6-10, 21–50=11-25, 50+=25+. lawyers = typical guests per stay (or 0). */
  guestKind?: GuestKind; interests?: TripType[]; roomsOfInterest?: string[]; stays?: number; repeatGuest?: boolean;
}

export interface ScoreFactor { label: string; points: number; detail: string }

export interface Lead {
  id: string; name: string; title: string; accountId: string;
  email: string; phone: string; city: City;
  stage: LeadStage; ownerId: string;
  /** Stored lead_status (spec 14). `stage` is the derived funnel position (status + linked deal). */
  status: LeadStatus;
  channel: Channel; campaignId: string | null;
  utm: { source: string; medium: string; campaign: string | null };
  firstTouch: Channel; lastTouch: Channel;
  createdAt: string; lastTouchAt: string; firstResponseMins: number | null;
  nextActionAt: string | null; nextAction: string | null;
  score: number; scoreFactors: ScoreFactor[];
  consent: { followup: boolean; marketing: boolean; whatsapp: boolean; at: string; noticeVersion: string };
  potentialValue: number; tags: string[];
  /** Hospitality (wg): trip type text is `title`; stay specifics here. */
  stay?: StayInfo;
}

export type ActivityKind =
  | "page_view" | "form_submit" | "ad_click" | "email_open" | "email_click" | "email_sent"
  | "whatsapp_in" | "whatsapp_out" | "call" | "linkedin" | "demo_booked" | "demo_done"
  | "stage_change" | "note" | "proposal_sent";
export interface Activity { id: string; leadId: string; kind: ActivityKind; at: string; title: string; detail?: string; byId?: string }

export interface Deal {
  id: string; name: string; accountId: string; leadId: string; ownerId: string;
  stage: DealStage; value: number; seats: number; plan: "Practice" | "Chambers" | "Enterprise"; // plan keys per spec; prices are placeholders until LAWSOME shares pricing
  probability: number; createdAt: string; expectedClose: string; stageEnteredAt: string;
  wonAt?: string; lostReason?: string;
  /** Hospitality (wg): a booking. seats = nights; plan is unused (always "Practice"). */
  stay?: BookingStay;
}

export interface Campaign {
  id: string; name: string; channel: Exclude<Channel, "organic" | "event">; /* referral = OTA / travel-agent programmes (hospitality) */
  status: "live" | "paused" | "ended"; objective: string;
  startDate: string; endDate: string | null; budget: number;
  audience: string; audienceSize: number;
  creative: { format: string; headline: string; body: string; cta: string };
  utmCampaign: string; ownerId: string; dataSource: "mock" | "csv" | "api";
}
export interface CampaignDay { campaignId: string; date: string; spend: number; impressions: number; reach: number; clicks: number; platformLeads: number; engagements: number }

export interface Ga4Day {
  date: string; sessions: number; users: number; engagedSessions: number; avgEngagementSecs: number; keyEvents: number;
  byChannel: Record<Ga4Channel, number>; byDevice: { mobile: number; desktop: number; tablet: number };
}
export type Ga4Channel = "Organic Search" | "Paid Search" | "Paid Social" | "Email" | "Direct" | "Referral";
export interface Ga4Page { path: string; title: string; sessions: number; engagementRate: number; avgSecs: number; conversions: number }

export interface Task {
  id: string; leadId: string | null; dealId: string | null; title: string;
  kind: "call" | "whatsapp" | "email" | "demo" | "follow_up" | "proposal";
  ownerId: string; dueAt: string; status: "open" | "done"; priority: "high" | "normal" | "low";
}

export interface Message { id: string; from: "lead" | "us"; authorId?: string; at: string; body: string; status?: "read" | "delivered" | "sent" }
export interface Conversation {
  id: string; leadId: string; channel: "whatsapp" | "email" | "linkedin"; subject: string;
  unread: number; lastAt: string; messages: Message[];
  /** Hospitality (wg): real medium when it is not one of `channel` (Instagram DM, phone call note). channel is then "whatsapp" as the closest chat style. */
  via?: "instagram" | "phone";
  aiDraft: { body: string; rationale: string[]; basedOn: string; needsReview?: string };
}

export type IntegrationCategory = "CRM" | "Messaging" | "Email" | "Ads" | "Analytics" | "Scheduling" | "Payments" | "Automation";
/** Spec enum. MVP never shows "connected": showcase = described, not wired (sampleFeed = the sample data imitates this source); not_configured = not set up. */
export type IntegrationStatus = "connected" | "showcase" | "needs_attention" | "error" | "not_configured";
export interface Integration {
  id: string; name: string; vendor: string; category: IntegrationCategory; status: IntegrationStatus; sampleFeed?: boolean;
  monogram: string; tone: 1 | 2 | 3 | 4 | 5; summary: string;
  trigger: "Webhook" | "Scheduled sync" | "Two-way sync" | "On demand";
  inbound: string[]; outbound: string[]; steps: string[];
  fieldMap: { source: string; target: string; note?: string }[];
  lastSyncAt: string | null; syncLog: { at: string; status: "success" | "partial" | "failed"; rows: number; note: string }[];
}

export interface ConsentEntry { id: string; leadId: string; purpose: "demo_followup" | "marketing_email" | "whatsapp"; action: "granted" | "withdrawn"; noticeVersion: string; via: string; at: string }
export interface PrivacyRequest { id: string; leadId: string; kind: "withdrawal" | "erasure" | "access"; receivedAt: string; dueAt: string; status: "open" | "in_progress" | "done" }
export interface AuditEntry { id: string; at: string; actorId: string; action: string; target: string; ip: string }
export interface SyncRun { id: string; integrationId: string; startedAt: string; durationSecs: number; status: "success" | "partial" | "failed"; rowsIn: number; rowsRejected: number; note: string }

export interface AiSettings { scoring: boolean; summaries: boolean; nextBestAction: boolean; replyDrafts: boolean; campaignDigest: boolean; askCrm: boolean }
export interface Holiday { date: string; name: string }

export interface Dataset {
  now: string;
  team: TeamMember[]; accounts: Account[]; leads: Lead[]; activities: Activity[]; deals: Deal[];
  campaigns: Campaign[]; campaignDays: CampaignDay[]; ga4: Ga4Day[]; ga4Pages: Ga4Page[];
  tasks: Task[]; conversations: Conversation[]; integrations: Integration[];
  consent: ConsentEntry[]; privacyRequests: PrivacyRequest[]; audit: AuditEntry[]; syncRuns: SyncRun[];
}
