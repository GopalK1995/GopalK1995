// Organic (non-ad) Instagram + Facebook Page metrics (T071). Pure types, safe in any bundle.
// Rule everywhere: a metric Meta does not report is null, never 0. No commenter names or comment text: counts only.
export type SocialPlatform = "instagram" | "facebook";
export type PostKind = "feed" | "reel" | "story" | "carousel" | "video";
/** Matches the social_posts.status check. A story past its 24 h window is `expired` (metrics captured while live stay in the daily table). */
export type PostStatus = "live" | "expired" | "deleted";

/** Counts for one post as of one day (Meta reports lifetime-to-date values; each daily row is that day's latest snapshot). */
export interface PostMetrics {
  impressions: number | null; reach: number | null; likes: number | null; comments: number | null;
  shares: number | null; saves: number | null; videoViews: number | null; linkClicks: number | null;
}
export const EMPTY_METRICS: PostMetrics = { impressions: null, reach: null, likes: null, comments: null, shares: null, saves: null, videoViews: null, linkClicks: null };

export interface AccountDay { day: string; followers: number | null; followerDelta: number | null; profileViews: number | null; reach: number | null; websiteClicks: number | null }

export interface RemotePost {
  externalId: string; kind: PostKind; caption: string | null; permalink: string | null; mediaUrl: string | null; postedAt: string;
  /** Counts that arrive with the post itself (Facebook reactions / comments / shares); merged into the insights result. */
  inline?: Partial<PostMetrics>;
}
export interface RemoteProfile { externalId: string; displayName: string | null; username: string | null; followers: number | null }

export interface Page<T> { items: T[]; after?: string }

/** What the sync needs from Meta. The Graph implementation (graph.ts) and unit-test fakes satisfy it. */
export interface OrganicGateway {
  readonly kind: "graph" | "fake";
  profile(p: SocialPlatform): Promise<RemoteProfile>;
  posts(p: SocialPlatform, i: { since?: string; after?: string }): Promise<Page<RemotePost>>;
  /** Stories are listed separately and only exist while live. */
  stories(p: SocialPlatform): Promise<RemotePost[]>;
  /** Null = Meta has no metrics for this post (too old, converted account, removed): stored as nulls, not zeros. */
  postMetrics(p: SocialPlatform, post: Pick<RemotePost, "externalId" | "kind" | "inline">): Promise<PostMetrics | null>;
  /**
   * Trailing account days. A metric Meta refuses is reported through `report(metric, graphCode)` and the rest still return; it throws only
   * when nothing could be read at all (so the run records a failure instead of an empty success).
   */
  accountDays(p: SocialPlatform, i: { since: string; until: string }, report?: (metric: string, code: number) => void): Promise<AccountDay[]>;
}

export interface StoredPost { id: string; externalId: string; kind: PostKind; postedAt: string; status: PostStatus; lastMetricsAt: string | null; hasMetrics: boolean }
export interface Scope { tenantId: string; workspaceId: string; connectionId: string }

export interface SocialStore {
  ensureAccount(i: Scope & { platform: SocialPlatform; externalId: string; displayName: string | null; username: string | null; followers: number | null; at: string }): Promise<{ id: string; lastPostAt: string | null }>;
  upsertPosts(i: Scope & { accountId: string; posts: (RemotePost & { status: PostStatus })[] }): Promise<void>;
  /** Posts of the account no older than `sinceIso`, with their sync bookkeeping (last metrics pull comes from the daily table). */
  listPosts(accountId: string, sinceIso: string): Promise<StoredPost[]>;
  setPostStatus(postId: string, status: PostStatus): Promise<void>;
  upsertPostMetrics(rows: { postId: string; day: string; metrics: PostMetrics; at: string }[], scope: Scope): Promise<void>;
  upsertAccountMetrics(rows: (AccountDay & { accountId: string; at: string })[], scope: Scope): Promise<void>;
  /** Outcome of the run on the account row (last_synced_at, last_sync_status, last_error). */
  markSynced(accountId: string, r: { at: string; status: "ok" | "partial" | "no_data" | "error" | "needs_attention"; error?: string | null }): Promise<void>;
}
