// The seam between the Business Profile sync / reply logic and Google. api.ts (real APIs) and mock.ts (Showcase).
import type { RawReview, RawSeries } from "./mappers";

export interface GbpLocation { account: string; location: string; title: string; address?: string }

export interface GbpGateway {
  readonly kind: "api" | "mock";
  /** Every location of every account the connected Google user manages. */
  listLocations(): Promise<GbpLocation[]>;
  /** One page of reviews, newest first. */
  listReviews(i: { account: string; location: string; pageToken?: string }): Promise<{ reviews: RawReview[]; nextPageToken?: string }>;
  /** Daily metric series for a closed date range (inclusive, YYYY-MM-DD). */
  dailyMetrics(i: { location: string; since: string; until: string }): Promise<RawSeries[]>;
  /** Posts (or replaces) the owner's public reply. Only ever called for an approved reply. */
  replyToReview(i: { account: string; location: string; reviewId: string; comment: string }): Promise<void>;
}
