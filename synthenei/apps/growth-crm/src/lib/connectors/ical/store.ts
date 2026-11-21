// Persistence port for the iCal connector: feeds (one row per calendar link, the URL itself in the Vault because Airbnb / Booking.com
// links are bearer secrets), export tokens (only the SHA-256 of the token is stored) and the needs_attention flag. The Supabase
// implementation (store-supabase.ts) uses the service role and scopes every call by tenant and workspace; tests use an in-memory fake.
import type { BookingRecordStore, Log } from "../channel-manager/booking-store";
import type { FeedSource } from "./constants";
import type { FeedFetcher } from "./fetch-types";

export interface FeedScope { tenantId: string; workspaceId: string; connectionId: string }
export interface FeedRow {
  id: string; tenantId: string; workspaceId: string; connectionId: string;
  /** The room / unit this calendar belongs to; becomes `booking.room`. */
  propertyKey: string; source: FeedSource; label: string; timezone: string | null;
  lastHash: string | null; failures: number; lastError: string | null; lastOkAt: string | null;
}
export interface NewFeed { tenantId: string; workspaceId: string; connectionId: string; propertyKey: string; source: FeedSource; label: string; timezone: string | null; url: string }
export interface TokenRow {
  id: string; tenantId: string; workspaceId: string; propertyKey: string;
  /** Events that came from this channel are left out of the feed, so a channel never receives its own bookings back. */
  excludeSource: FeedSource | null; revokedAt: string | null; lastFetchedAt: string | null; createdAt: string;
}
export interface NewToken { tenantId: string; workspaceId: string; propertyKey: string; excludeSource: FeedSource | null; tokenHash: string; createdBy: string }
export interface AttentionNotice { dedupe: string; title: Record<string, string>; body: Record<string, string>; url: string | null }

export interface IcalStore {
  listFeeds(s: FeedScope): Promise<FeedRow[]>;
  /** Feeds of a workspace regardless of connection (limit checks and the settings list). */
  countFeeds(s: { tenantId: string; workspaceId: string }): Promise<number>;
  /** The feed URL from the Vault. Never logged, never returned to a client. */
  feedUrl(f: FeedRow): Promise<string | null>;
  createFeed(f: NewFeed): Promise<FeedRow>;
  /** Removes the feed and its Vault secret. Imported booking records stay (they are history). */
  deleteFeed(s: FeedScope, feedId: string): Promise<boolean>;
  recordFeedOk(f: FeedRow, r: { hash: string; at: string }): Promise<void>;
  /** Returns the consecutive failure count after this one. `code` is a short machine reason, never a URL or body. */
  recordFeedFailure(f: FeedRow, r: { code: string; at: string }): Promise<number>;
  resetFailures(s: FeedScope): Promise<void>;
  /** integrations.status = needs_attention with a readable last_error, plus one in-app notice per workspace owner (deduped by `dedupe`). */
  flagNeedsAttention(s: FeedScope, message: string, notice: AttentionNotice): Promise<void>;

  findTokenByHash(hash: string): Promise<TokenRow | null>;
  createToken(t: NewToken): Promise<TokenRow>;
  listTokens(s: { tenantId: string; workspaceId: string }): Promise<TokenRow[]>;
  revokeToken(s: { tenantId: string; workspaceId: string }, tokenId: string, at: string): Promise<boolean>;
  touchToken(id: string, at: string): Promise<void>;
}

export interface IcalDeps {
  store: IcalStore; records: BookingRecordStore; fetch: FeedFetcher; log: Log; now: () => Date;
  /** Writes an audit row. For actions started by a person it must throw on failure (the action then does not happen). */
  audit: (e: { action: string; summary: string; detail?: Record<string, unknown> }) => Promise<void>;
}
