// Persistence port for the Meta connector. The Supabase implementation (store-supabase.ts, service role) is the only one that
// touches tables; unit tests pass an in-memory fake. Every method is scoped by tenant and/or workspace. Lead dedupe, field maps
// and external links reuse the framework's ConnectorStore (CoreLeadPort), so leads follow the same rules as every other connector.
import type { ConnectorStore } from "../core/ports";

export interface ConnScope { tenantId: string; workspaceId: string; connectionId: string }

export type CoreLeadPort = Pick<ConnectorStore, "getFieldMap" | "getLink" | "putLink" | "touchLink" | "findByMatchKey" | "insertLocal" | "updateLocal">;

export interface AssetRegistration extends ConnScope {
  pageId: string; pageName?: string; igUserId?: string; igUsername?: string; adAccountId?: string; adAccountName?: string; currency?: string;
}
export type RegisterResult = { ok: true } | { ok: false; reason: "page_taken" | "ig_taken" };

export interface DailyMetricRow {
  campaignId: string; externalCampaignId: string; day: string; spendInr: number; impressions: number; reach: number; clicks: number;
  reactions: number; comments: number; shares: number; platformLeads: number;
}
export interface ConsentEntry {
  tenantId: string; workspaceId: string; leadId: string; subjectRef: string; purpose: "demo_followup" | "marketing_email" | "whatsapp";
  noticeVersion: string; note: string;
}

export interface ConversationRef { id: string; leadId: string | null; lastInboundAt: string | null; status: string; created: boolean }
export interface NewInboundMessage { tenantId: string; workspaceId: string; conversationId: string; mid: string; body: string; at: string; replyToMid?: string }
export type InsertResult = { id: string } | { duplicate: true };
export interface OutboundRow {
  id: string; tenantId: string; workspaceId: string; conversationId: string; status: string; body: string | null; isInternalNote: boolean;
  channel: string; leadId: string | null; threadId: string | null; lastInboundAt: string | null;
}
export interface OutboundPatch { status: string; externalId?: string | null; statusAt: string; errorCode?: string | null; errorDetail?: string | null }

export interface MetaStore {
  /** page_id and ig_user_id -> workspace. Globally unique: an asset owned by another workspace's live connection is refused. */
  registerAssets(a: AssetRegistration): Promise<RegisterResult>;
  /** Finds the campaign for a Meta campaign id in this workspace, creating it when unknown. `synthetic` marks sandbox rows. */
  ensureCampaign(i: { tenantId: string; workspaceId: string; externalId: string; name: string; synthetic: boolean }): Promise<string>;
  /** Upserts on (campaign, day): re-running a day replaces it, never doubles it. `source` is api for the real gateway, mock for the sandbox. */
  upsertDailyMetrics(rows: DailyMetricRow[], ctx: ConnScope & { source: "api" | "mock" }): Promise<void>;
  /** Records a granted consent once per `note` for the lead and purpose (the note carries the leadgen id). Returns true when written. */
  recordConsentOnce(c: ConsentEntry): Promise<boolean>;

  findMessageByExternalId(tenantId: string, externalId: string): Promise<{ id: string; conversationId: string } | null>;
  upsertConversation(c: { tenantId: string; workspaceId: string; threadId: string; leadId: string | null }): Promise<ConversationRef>;
  insertInbound(m: NewInboundMessage): Promise<InsertResult>;
  /** last_inbound_at only moves forward; a closed conversation is reopened. */
  touchInbound(conversationId: string, atIso: string, leadId: string | null): Promise<void>;
  findLeadByIgsid(workspaceId: string, igsid: string): Promise<string | null>;
  createLead(row: Record<string, unknown>): Promise<string>;

  getOutbound(id: string): Promise<OutboundRow | null>;
  listQueuedOutbound(workspaceId: string, limit: number): Promise<string[]>;
  patchOutbound(id: string, patch: OutboundPatch): Promise<void>;

  emit(e: { type: "message.received" | "message.sent" | "consent.changed"; workspaceId: string; objectType: string; objectId: string; data: Record<string, unknown> }): Promise<void>;
}

export interface MetaDeps {
  store: MetaStore;
  core: CoreLeadPort;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
  /** Outbound throttle: true = allowed. */
  rate: (key: string, limit: number, windowMs: number) => Promise<boolean>;
}
