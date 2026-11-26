// Organic sync: one run per connection, scheduled every 3 hours (cron `0 */3 * * *`, Asia/Kolkata) and on "Refresh now". Posts are fetched
// incrementally (since the newest stored post, one-day overlap). Metrics are re-fetched on every run for posts younger than 30 days and
// weekly after that; stories are captured on every run while live (24 h window). Every write is an upsert keyed on (account, external id),
// (post, day) and (account, day), so re-running never doubles a row. A metric Meta cannot give is stored as null, never 0.
// A rate-limit that outlasts the backoff ends the run early (partial, the next slot continues); a dead token throws CredentialError
// (needs_attention). Comment text and commenter identities are never read: only counts.
import { CredentialError, TransientError, type SyncResult } from "../../core/types";
import { MetaApiError } from "../../meta-ads/gateway";
import { addDays, istDay } from "../../meta-ads/insights";
import { hasAnyMetric, postStatus, shouldRefreshMetrics, storyStatus } from "./mappers";
import { EMPTY_METRICS, type OrganicGateway, type PostMetrics, type RemotePost, type Scope, type SocialPlatform, type SocialStore } from "./types";

export const SYNC_CRON = "0 */3 * * *";
export const BACKFILL_DAYS = 120;   // first run: as far back as post metrics are kept fresh (LOOKBACK_POST_DAYS); older than a month is normal for a small account
export const OVERLAP_DAYS = 1;
export const MAX_POST_PAGES = 10;
export const METRICS_BUDGET = 80;
export const LOOKBACK_POST_DAYS = 120;
export const ACCOUNT_LOOKBACK_DAYS = 3;
const DAY_MS = 86400e3;

export interface OrganicDeps { store: SocialStore; gateway: OrganicGateway; now: () => Date; log?: { warn(m: string, f?: Record<string, unknown>): void } }
export interface OrganicConn extends Scope { igUserId?: string; pageId?: string }

export interface PlatformResult {
  platform: SocialPlatform; posts: number; metrics: number; rejected: number; partial: boolean;
  /** account-level day rows written */ accountRows: number;
  /** PII-free codes of what went wrong (Graph code per metric group), shown on the account and in the run note */
  issues: string[];
  /** Meta answered but there is nothing to show: no feed/reel/video post at all, or a page with no followers and no posts */
  noData: boolean;
}

export async function syncPlatform(d: OrganicDeps, c: OrganicConn, platform: SocialPlatform, reject: (r: string) => void): Promise<PlatformResult> {
  const now = d.now(), nowIso = now.toISOString(), today = istDay(now);
  const out: PlatformResult = { platform, posts: 0, metrics: 0, rejected: 0, partial: false, accountRows: 0, issues: [], noData: false };
  const profile = await d.gateway.profile(platform);
  const acct = await d.store.ensureAccount({ ...c, platform, externalId: profile.externalId, displayName: profile.displayName, username: profile.username, followers: profile.followers, at: nowIso });

  try {
    // 1. new posts (+ live stories), incremental
    const since = acct.lastPostAt ? new Date(Date.parse(acct.lastPostAt) - OVERLAP_DAYS * DAY_MS).toISOString() : new Date(now.getTime() - BACKFILL_DAYS * DAY_MS).toISOString();
    const seen = new Map<string, RemotePost>();
    let after: string | undefined;
    for (let i = 0; i < MAX_POST_PAGES; i++) {
      const page = await d.gateway.posts(platform, { since, after });
      // Instagram's /media edge is not time-filtered server side (see graph.ts): keep what is newer than the cut-off and stop paging
      // once a whole page is older, so an incremental run reads one page, not the whole history.
      const sinceMs = Date.parse(since);
      for (const p of page.items) if (Date.parse(p.postedAt) >= sinceMs) seen.set(p.externalId, p);
      after = page.after;
      if (!after || (page.items.length > 0 && page.items.every((p) => Date.parse(p.postedAt) < sinceMs))) { after = undefined; break; }
    }
    if (after) out.partial = true;   // more history than one run reads; the next run continues from the newest stored post
    for (const s of await d.gateway.stories(platform)) seen.set(s.externalId, s);
    const fresh = [...seen.values()].map((p) => ({ ...p, status: postStatus(p, now) }));
    if (fresh.length) await d.store.upsertPosts({ ...c, accountId: acct.id, posts: fresh });
    out.posts = fresh.length;

    // 2. story window: a story past 24 h is expired and never asked again
    const stored = await d.store.listPosts(acct.id, new Date(now.getTime() - LOOKBACK_POST_DAYS * DAY_MS).toISOString());
    for (const p of stored) {
      if (p.kind === "story" && p.status === "live" && storyStatus(p.postedAt, now) === "expired") { await d.store.setPostStatus(p.id, "expired"); p.status = "expired"; }
    }

    // 3. metrics for due posts (never-fetched first, then the longest-waiting), bounded per run
    const due = stored.filter((p) => shouldRefreshMetrics(p, now))
      .sort((a, b) => (a.lastMetricsAt ? Date.parse(a.lastMetricsAt) : 0) - (b.lastMetricsAt ? Date.parse(b.lastMetricsAt) : 0));
    const rows: { postId: string; day: string; metrics: PostMetrics; at: string }[] = [];
    const flush = async () => { if (rows.length) await d.store.upsertPostMetrics(rows.splice(0), c); };
    let budget = METRICS_BUDGET;
    try {
      for (const p of due) {
        if (budget-- <= 0) { out.partial = true; break; }
        try {
          const m = await d.gateway.postMetrics(platform, { externalId: p.externalId, kind: p.kind, inline: seen.get(p.externalId)?.inline });
          rows.push({ postId: p.id, day: today, metrics: m ?? EMPTY_METRICS, at: nowIso });   // no data from Meta = nulls, stamped so it is not re-asked at once
          if (m && hasAnyMetric(m)) out.metrics++; else { out.rejected++; reject("no_insights"); }
        } catch (e) {
          if (e instanceof CredentialError) throw e;
          if (e instanceof TransientError) { out.partial = true; d.log?.warn("organic metrics stopped by rate limit", { platform }); break; }
          const code = e instanceof MetaApiError ? e.code : 0;
          out.rejected++; reject(code ? `post_metrics_graph_${code}` : "post_metrics_failed");
          if (code && !out.issues.includes(`post_metrics:${code}`)) out.issues.push(`post_metrics:${code}`);
        }
      }
    } finally { await flush(); }

    // 4. account trend: re-read the trailing days (Meta restates). Each metric group is isolated; a refused group is recorded with its Graph code.
    try {
      const days = await d.gateway.accountDays(platform, { since: addDays(today, -ACCOUNT_LOOKBACK_DAYS), until: today }, (metric, code) => {
        out.rejected++; reject(`account_${metric}_graph_${code}`); out.issues.push(`${metric}:${code}`);
      });
      // Today's follower count is a fact we already hold (profile call): always keep it as a row, even when every insights metric failed,
      // so the follower trend is not empty while the account has followers.
      const withTotal = days.map((r, i) => (i === days.length - 1 && r.followers === null && profile.followers !== null ? { ...r, followers: profile.followers } : r));
      if (profile.followers !== null && !withTotal.some((r) => r.day === today)) withTotal.push({ day: today, followers: profile.followers, followerDelta: null, profileViews: null, reach: null, websiteClicks: null });
      else if (profile.followers !== null) { const t = withTotal.find((r) => r.day === today)!; if (t.followers === null) t.followers = profile.followers; }
      if (withTotal.length) await d.store.upsertAccountMetrics(withTotal.map((r) => ({ ...r, accountId: acct.id, at: nowIso })), c);
      out.accountRows = withTotal.length;
    } catch (e) {
      if (e instanceof CredentialError) throw e;
      if (e instanceof TransientError) out.partial = true;
      else { const code = e instanceof MetaApiError ? e.code : 0; out.rejected++; reject(code ? `account_metrics_graph_${code}` : "account_metrics_failed"); out.issues.push(`account_metrics:${code || "error"}`); }
    }

    // 5. honest outcome. Nothing from Meta is "no data", not "ok"; a refused metric or a stopped run is "partial".
    const feedPosts = stored.filter((p) => p.kind !== "story").length + fresh.filter((p) => p.kind !== "story" && !stored.some((s) => s.externalId === p.externalId)).length;
    const emptyPage = platform === "facebook" && (profile.followers ?? 0) === 0 && feedPosts === 0;   // INTG-040: 0 followers + 0 posts is not a measurement
    out.noData = feedPosts === 0 || emptyPage;
    if (feedPosts === 0) out.issues.push("no_posts_returned");
    const status = out.partial || out.rejected > 0 || out.issues.some((x) => x !== "no_posts_returned") ? "partial" : out.noData ? "no_data" : "ok";
    const error = out.issues.length ? `Meta: ${out.issues.slice(0, 6).join(", ")}` : null;
    await d.store.markSynced(acct.id, { at: nowIso, status, error });
  } catch (e) {
    if (e instanceof CredentialError) { await d.store.markSynced(acct.id, { at: nowIso, status: "needs_attention", error: "Meta rejected the saved credentials" }).catch(() => undefined); throw e; }
    await d.store.markSynced(acct.id, { at: nowIso, status: "error", error: e instanceof TransientError ? "Meta is busy or unreachable" : "Sync stopped" }).catch(() => undefined);
    throw e;
  }
  return out;
}

export async function organicStep(d: OrganicDeps, c: OrganicConn, reject: (r: string) => void): Promise<SyncResult> {
  const platforms: SocialPlatform[] = [...(c.igUserId ? ["instagram" as const] : []), ...(c.pageId ? ["facebook" as const] : [])];
  if (!platforms.length) return { cursor: null, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_accounts" }, status: "skipped", reason: "no_page_or_instagram_selected" };
  const results: PlatformResult[] = [];
  let transient = false;
  for (const p of platforms) {
    try { results.push(await syncPlatform(d, c, p, reject)); }
    catch (e) { if (e instanceof TransientError) { transient = true; continue; } throw e; }
  }
  const rowsIn = results.reduce((s, r) => s + r.posts + r.metrics + r.accountRows, 0);
  const issues = results.flatMap((r) => r.issues.filter((x) => x !== "no_posts_returned").map((x) => `${r.platform}.${x}`));
  const pending = transient || results.some((r) => r.partial);
  // Run-level status for the sync log: stopped early / refused metrics = partial; every platform empty = no_data (the account is connected
  // and answered, there is just nothing to show). Never plain success for either.
  const status = pending || issues.length ? ("partial" as const) : results.length > 0 && results.every((r) => r.noData) ? ("no_data" as const) : undefined;
  const reason = pending && !issues.length ? "rate_limited_or_page_cap" : issues.length ? issues.slice(0, 4).join(",") : status === "no_data" ? "no_posts_returned" : undefined;
  return {
    cursor: { at: d.now().toISOString() }, rowsIn, rowsRejected: results.reduce((s, r) => s + r.rejected, 0), done: true, ...(status ? { status, reason } : {}),
    sample: { mode: d.gateway.kind, platforms: results.map((r) => ({ p: r.platform, posts: r.posts, metrics: r.metrics, account_rows: r.accountRows, issues: r.issues })), pending },
  };
}
