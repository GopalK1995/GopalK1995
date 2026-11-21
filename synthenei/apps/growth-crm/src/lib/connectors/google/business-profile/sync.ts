// Business Profile streams. `reviews`: pages through the listing's reviews (newest first, resumable by page token) into `reviews`;
// idempotent on (connection, review id), never touches reply state. `performance`: daily search / maps impressions and call, website,
// direction, conversation, booking and food-order counts into gbp_daily; resumable window, trailing week re-read, null never zero.
import type { ConnectionRow, ConnectionSecrets, SyncResult } from "../../core/types";
import { asDailyCursor, planWindow, type PagedWindow } from "../shared/dates";
import { scopeOf } from "../shared/mode";
import { GBP_CRED, PERFORMANCE_POLICY, REVIEW_PAGES_PER_STEP } from "./constants";
import type { GbpGateway } from "./gateway";
import { foldSeries, normaliseReview, type ReviewRow } from "./mappers";
import type { GbpDeps } from "./store";

export interface GbpStreamCtx { deps: GbpDeps; conn: ConnectionRow; secrets: ConnectionSecrets; gateway: GbpGateway; reject: (reason: string) => void }

interface ReviewCursor { page?: string }
const asReviewCursor = (c: unknown): ReviewCursor => (c && typeof c === "object" && typeof (c as ReviewCursor).page === "string" && (c as ReviewCursor).page ? { page: (c as ReviewCursor).page } : {});

export async function reviewsStep(c: GbpStreamCtx, cursorIn: unknown): Promise<SyncResult> {
  const account = c.secrets[GBP_CRED.account], location = c.secrets[GBP_CRED.location];
  const cur = asReviewCursor(cursorIn);
  if (!account || !location) return { cursor: {}, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_listing" } };
  let page = cur.page, rows = 0, rejected = 0, created = 0, updated = 0;
  for (let n = 0; n < REVIEW_PAGES_PER_STEP; n++) {
    const r = await c.gateway.listReviews({ account, location, pageToken: page });
    const good: ReviewRow[] = [];
    for (const raw of r.reviews) {
      const m = normaliseReview(raw);
      if (!m.ok) { rejected++; c.reject(m.reason); continue; }
      good.push(m.row);
    }
    if (good.length) { const w = await c.deps.store.upsertReviews(good, scopeOf(c.conn)); created += w.created; updated += w.updated; }
    rows += good.length;
    page = r.nextPageToken;
    if (!page) return { cursor: {}, rowsIn: rows, rowsRejected: rejected, done: true, sample: { created, updated, mode: c.gateway.kind } };
  }
  return { cursor: { page }, rowsIn: rows, rowsRejected: rejected, done: false, sample: { created, updated, mode: c.gateway.kind } };
}

export async function performanceStep(c: GbpStreamCtx, cursorIn: unknown): Promise<SyncResult> {
  const location = c.secrets[GBP_CRED.location], cur = asDailyCursor(cursorIn);
  if (!location) return { cursor: cur, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_listing" } };
  const win: PagedWindow | null = cur.win ?? planWindow(c.deps.now(), cur.through, PERFORMANCE_POLICY);
  if (!win) return { cursor: { through: cur.through }, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "up_to_date" } };
  const until = win.until;
  const series = await c.gateway.dailyMetrics({ location, since: win.since, until });
  const { rows, rejected } = foldSeries(series, win.since, until);
  for (let i = 0; i < rejected; i++) c.reject("unreadable_metric");
  if (rows.length) await c.deps.store.upsertDaily(rows, { ...scopeOf(c.conn), locationId: location, source: c.gateway.kind });
  return { cursor: { through: until }, rowsIn: rows.length, rowsRejected: rejected, done: true, sample: { days: `${win.since}..${until}`, rows: rows.length, mode: c.gateway.kind } };
}
