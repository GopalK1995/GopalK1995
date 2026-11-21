// Persistence port for the Business Profile connector. Supabase implementation in store-supabase.ts (service role); tests pass a fake.
// Reviews live in `reviews` (0019). Daily performance lives in `gbp_daily` (SQL under "T045 needs" in docs/migrations-backlog.md).
import type { ConnScope } from "../shared/mode";
import type { MetricsRow, ReviewRow } from "./mappers";

export type ReplyStatus = "none" | "draft" | "pending_approval" | "approved" | "posted" | "failed";
export type ReplySource = "ai" | "template" | "human";

export interface StoredReview {
  id: string; tenantId: string; workspaceId: string; connectionId: string | null; externalId: string | null;
  rating: number | null; text: string | null; author: string | null;
  replyDraft: string | null; replyStatus: ReplyStatus; replyApprovedBy: string | null; replySource: ReplySource | null;
}
export interface ReplyPatch { replyDraft?: string | null; replyStatus?: ReplyStatus; replyApprovedBy?: string | null; replySource?: ReplySource | null; replyError?: string | null }

export interface GbpStore {
  /**
   * Inserts new reviews and refreshes rating / text / author / date of known ones. NEVER touches reply_draft, reply_status or the
   * approver: a re-sync cannot undo or bypass an approval. Returns counts.
   */
  upsertReviews(rows: ReviewRow[], ctx: ConnScope): Promise<{ created: number; updated: number }>;
  /** Upserts on (workspace, connection, day): re-running a day replaces it, never doubles it. */
  upsertDaily(rows: MetricsRow[], ctx: ConnScope & { locationId: string; source: "api" | "mock" }): Promise<void>;
  /** Scoped by tenant and workspace; another workspace's review looks missing. */
  getReview(scope: { tenantId: string; workspaceId: string }, id: string): Promise<StoredReview | null>;
  /** Applies the patch only while the row is still in `expect` (compare-and-set), so two people cannot both post. Returns false if it moved. */
  updateReply(scope: { tenantId: string; workspaceId: string }, id: string, expect: ReplyStatus[], patch: ReplyPatch): Promise<boolean>;
}
export interface GbpDeps {
  store: GbpStore;
  log: { info(m: string, f?: Record<string, unknown>): void; warn(m: string, f?: Record<string, unknown>): void; error(m: string, f?: Record<string, unknown>): void };
  now: () => Date;
}
