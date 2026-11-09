// The seam between the connector logic and Meta. Two implementations: graph.ts (real Graph API) and mock.ts (sandbox, no network).
import { CredentialError } from "../core/types";

export interface GraphLead {
  id: string; createdAt?: string; formId?: string; adId?: string; adName?: string; adsetId?: string; adsetName?: string;
  campaignId?: string; campaignName?: string; isOrganic?: boolean; platform?: string;
  /** Form answers by question name (multi-value answers joined with ", "). */
  fields: Record<string, string>;
  /** custom_disclaimer_responses: the checkbox key and whether the person ticked it. */
  disclaimers: { key: string; checked: boolean }[];
}
export interface PageAsset { id: string; name: string; igUserId?: string; igUsername?: string }
/** Server-internal: carries the page token. Never returned to a client. */
export interface PageWithToken extends PageAsset { pageToken: string }
export interface AdAccountAsset { id: string; name: string; currency: string }

export interface RawAction { action_type?: string; value?: string }
export interface RawInsight {
  campaign_id?: string; campaign_name?: string; date_start?: string; date_stop?: string; account_currency?: string;
  spend?: string | number; impressions?: string | number; reach?: string | number; clicks?: string | number; actions?: RawAction[];
}
export interface InsightsPage { rows: RawInsight[]; after?: string }
export interface TokenDebug { valid: boolean; /** unix seconds; 0 = does not expire; null = unknown */ expiresAt: number | null; scopes: string[] }

export interface MetaGateway {
  /** "mock" never touches the network; the UI shows the Showcase label for it. */
  readonly kind: "graph" | "mock";
  /** null when the lead no longer exists (deleted or no longer visible to the page). */
  getLead(leadgenId: string): Promise<GraphLead | null>;
  listPages(): Promise<PageWithToken[]>;
  listAdAccounts(): Promise<AdAccountAsset[]>;
  subscribePage(pageId: string, pageToken: string, fields: string[]): Promise<void>;
  insights(i: { adAccountId: string; since: string; until: string; after?: string }): Promise<InsightsPage>;
  igProfile(senderId: string): Promise<{ name?: string; username?: string }>;
  sendIgMessage(i: { recipientId: string; text: string }): Promise<{ mid: string }>;
  debugToken(): Promise<TokenDebug>;
  /** fb_exchange_token: a long-lived (about 60 day) user token from the given one. */
  exchangeLongLived(): Promise<{ accessToken: string; expiresInSec?: number }>;
}

export type ApiFailure = "window_closed" | "rate_limited" | "recipient_unavailable" | "permission" | "not_found" | "token" | "other";

/** A Graph error with the vendor code kept, so a failed send can say why. The message never carries the request, recipient or token. */
export class MetaApiError extends Error {
  constructor(public code: number, public subcode: number, message: string, public httpStatus: number, public failure: ApiFailure, public transient: boolean) {
    super(message);
    this.name = "MetaApiError";
  }
}

const TOKEN = new Set([190, 102, 463, 467, 459, 460]);
const PERMISSION = new Set([10, 200, 299, 3]);
const RATE = new Set([4, 17, 32, 341, 613]);
const TRANSIENT = new Set([1, 2]);

export function classifyError(code: number, subcode: number, httpStatus: number): { failure: ApiFailure; transient: boolean } {
  if (TOKEN.has(code) || httpStatus === 401) return { failure: "token", transient: false };
  if (code === 10 && subcode === 2534022) return { failure: "window_closed", transient: false };
  if (RATE.has(code) || (code >= 80000 && code <= 80014)) return { failure: "rate_limited", transient: true };
  if (code === 100 && subcode === 33) return { failure: "not_found", transient: false };
  if (code === 551 || (code === 100 && subcode === 2534014)) return { failure: "recipient_unavailable", transient: false };
  if ((PERMISSION.has(code) || (code >= 200 && code <= 299)) && code !== 17) return { failure: "permission", transient: false };
  return { failure: "other", transient: TRANSIENT.has(code) || httpStatus >= 500 || httpStatus === 429 };
}

/** Maps a Graph error body ({error:{code,error_subcode,...}}) to the right throwable. A dead token or a missing permission needs the owner. */
export function errorFromResponse(status: number, body: unknown): Error {
  const e = body && typeof body === "object" ? (body as { error?: Record<string, unknown> }).error : undefined;
  const code = typeof e?.code === "number" ? e.code : 0, subcode = typeof e?.error_subcode === "number" ? e.error_subcode : 0;
  const c = classifyError(code, subcode, status);
  if (c.failure === "token") return new CredentialError("Meta rejected the access token (expired or revoked)");
  if (c.failure === "permission") return new CredentialError("Meta refused a permission this connection needs (reconnect and grant it)");
  // The vendor message can quote the recipient or form data; keep only the code and a fixed label.
  return new MetaApiError(code, subcode, `Meta API error ${code || status}`, status, c.failure, c.transient);
}
