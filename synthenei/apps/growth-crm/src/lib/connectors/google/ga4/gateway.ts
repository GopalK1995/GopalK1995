// The seam between the GA4 sync logic and Google. Two implementations: api.ts (real Admin + Data APIs) and mock.ts (Showcase, no network).
import type { RunReportResponse } from "./report";

export interface Ga4Property { id: string; name: string; account?: string }

export interface Ga4Gateway {
  /** "mock" never touches the network; the UI shows the Showcase label for it. */
  readonly kind: "api" | "mock";
  /** Properties the connected Google user can read (Admin API accountSummaries, all pages). */
  listProperties(): Promise<Ga4Property[]>;
  runReport(i: { propertyId: string; since: string; until: string; offset: number; limit: number }): Promise<RunReportResponse>;
}
