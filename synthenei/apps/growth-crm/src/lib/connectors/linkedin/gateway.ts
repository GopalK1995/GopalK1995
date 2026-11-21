// The seam between the connector logic and LinkedIn. Two implementations: rest.ts (real REST API) and mock.ts (sandbox, no network).
// LinkedIn has no public sandbox: logic is tested against recorded-shape fixtures (__fixtures__) through these types.
import { CredentialError } from "../core/types";

export interface LeadAnswer { questionId: string; /** Normalised value (multi-choice joined with ", "). */ value: string }
export interface LeadResponse {
  id: string;
  /** Epoch ms. */
  submittedAt: number;
  /** Ad account URN the response belongs to (the isolation check compares it with the connection's own account). */
  ownerAccountUrn: string | null;
  formUrn: string | null;
  campaignUrn: string | null;
  testLead: boolean;
  answers: LeadAnswer[];
  /** consentResponses: consent id and whether the person accepted. */
  consents: { id: string; accepted: boolean }[];
}
export interface LeadsPage { rows: LeadResponse[]; /** start offset of the next page, absent on the last page */ nextStart?: number }
export interface AdAccountAsset { id: string; name: string; currency: string }
export interface RawAnalytics {
  pivotValues?: string[]; dateRange?: { start?: { year?: number; month?: number; day?: number } };
  costInLocalCurrency?: string | number; impressions?: string | number; clicks?: string | number; oneClickLeads?: string | number;
}
export interface TokenInfo { active: boolean; /** unix seconds; null = unknown */ expiresAt: number | null; scopes: string[] }

export interface LinkedInGateway {
  /** "mock" never touches the network; the UI shows the Showcase label for it. */
  readonly kind: "rest" | "mock";
  listAdAccounts(): Promise<AdAccountAsset[]>;
  /** Lead form responses of one ad account submitted at or after `sinceMs`, oldest first. */
  listLeadResponses(i: { accountUrn: string; sinceMs: number; start: number; count: number }): Promise<LeadsPage>;
  /** questionId -> field key (lower-case predefined field name, or `custom_<id>`). Empty map when the form cannot be read. */
  formQuestions(formUrn: string): Promise<Map<string, string>>;
  analytics(i: { accountUrn: string; since: string; until: string }): Promise<RawAnalytics[]>;
  campaignNames(accountId: string): Promise<Map<string, string>>;
  accountCurrency(accountId: string): Promise<string>;
  introspect(): Promise<TokenInfo>;
}

/** An API error with the vendor status kept. The message never carries the request, answers or token. */
export class LinkedInApiError extends Error {
  constructor(public httpStatus: number, message: string) { super(message); this.name = "LinkedInApiError"; }
}

/** A dead token or a missing product / permission needs the owner (needs_attention). */
export function errorFromStatus(status: number): Error {
  if (status === 401) return new CredentialError("LinkedIn rejected the access token (expired or revoked)");
  if (status === 403) return new CredentialError("LinkedIn refused access: the product or scope is not granted to this app or user");
  return new LinkedInApiError(status, `LinkedIn API error ${status}`);
}
