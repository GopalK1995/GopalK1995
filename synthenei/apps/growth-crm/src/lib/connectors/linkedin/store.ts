// Persistence port for the LinkedIn connector. The Supabase implementation (store-supabase.ts, service role) is the only one that
// touches tables; unit tests pass an in-memory fake. Lead dedupe, field maps and external links reuse the framework's ConnectorStore
// (CoreLeadPort), so leads follow the same rules as every other connector.
import type { ConnectorStore } from "../core/ports";

export interface ConnScope { tenantId: string; workspaceId: string; connectionId: string }
export type CoreLeadPort = Pick<ConnectorStore, "getFieldMap" | "getLink" | "putLink" | "touchLink" | "findByMatchKey" | "insertLocal" | "updateLocal">;

export interface AccountRegistration extends ConnScope { accountId: string; name?: string; currency?: string }
export type RegisterResult = { ok: true } | { ok: false; reason: "account_taken" };

export interface DailyMetricRow { campaignId: string; externalCampaignId: string; day: string; spendInr: number; impressions: number; clicks: number; platformLeads: number }
export interface ConsentEntry {
  tenantId: string; workspaceId: string; leadId: string; subjectRef: string; purpose: "demo_followup" | "marketing_email" | "whatsapp";
  noticeVersion: string; note: string;
}

export interface LinkedInStore {
  /** ad account id -> workspace. Globally unique: an account owned by another workspace's live connection is refused. */
  registerAccount(a: AccountRegistration): Promise<RegisterResult>;
  /** Finds the campaign for a LinkedIn campaign id in this workspace, creating it when unknown. `placeholder` = the name is a stand-in a real name may replace. */
  ensureCampaign(i: { tenantId: string; workspaceId: string; externalId: string; name: string; placeholder: boolean; synthetic: boolean }): Promise<string>;
  /** Upserts on (campaign, day): re-running a day replaces it, never doubles it. `source` is api for the real gateway, mock for the sandbox. */
  upsertDailyMetrics(rows: DailyMetricRow[], ctx: ConnScope & { source: "api" | "mock" }): Promise<void>;
  /** Records a granted consent once per `note` for the lead and purpose (the note carries the response id). Returns true when written. */
  recordConsentOnce(c: ConsentEntry): Promise<boolean>;
  emit(e: { type: "consent.changed"; workspaceId: string; objectType: string; objectId: string; data: Record<string, unknown> }): Promise<void>;
}

export interface LinkedInDeps {
  store: LinkedInStore;
  core: CoreLeadPort;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
}
