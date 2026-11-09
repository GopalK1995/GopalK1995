// The seam between the Google Ads sync logic and Google. Two implementations: api.ts (real Google Ads API) and mock.ts (Showcase).
import type { AdsPage } from "./report";

export interface AdsCustomer {
  id: string; name: string; currency: string; manager: boolean;
  /** Set when the account is reached through a manager (MCC): sent as login-customer-id on every call for it. */
  loginCustomerId?: string;
}

export interface AdsGateway {
  /** "mock" never touches the network; the UI shows the Showcase label for it. */
  readonly kind: "api" | "mock";
  /** Client accounts the connected Google user can read: directly accessible ones plus the clients of managers they can open. */
  listCustomers(): Promise<AdsCustomer[]>;
  /** One GAQL page of the daily campaign report (pagination by nextPageToken). */
  campaignMetrics(i: { customerId: string; loginCustomerId?: string; since: string; until: string; pageToken?: string }): Promise<AdsPage>;
}
