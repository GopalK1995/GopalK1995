// Organic sync: one run per connection, scheduled every 3 hours (cron `0 */3 * * *`, Asia/Kolkata) and on "Refresh now". Posts are fetched
// incrementally (since the newest stored post, one-day overlap). Metrics are re-fetched on every run for posts younger than 30 days and
// weekly after that; stories are captured on every run while live (24 h window). Every write is an upsert keyed on (account, external id),
// (post, day) and (account, day), so re-running never doubles a row. A metric Meta cannot give is stored as null, never 0.
// A rate-limit that outlasts the backoff ends the run early (partial, the next slot continues); a dead token throws CredentialError
// (needs_attention). Comment text and commenter identities are never read: only counts.
import { CredentialError, TransientError, type SyncResult } from "../../core/types";
import { addDays, istDay } from "../../meta-ads/insights";
import { hasAnyMetric, postStatus, shouldRefreshMetrics, storyStatus } from "./mappers";
import { EMPTY_METRICS, type OrganicGateway, type PostMetrics, type RemotePost, type Scope, type SocialPlatform, type SocialStore } from "./types";

export const SYNC_CRON = "0 */3 * * *";
export const BACKFILL_DAYS = 30;
export const OVERLAP_DAYS = 1;
export const MAX_POST_PAGES = 10;
export const METRICS_BUDGET = 80;
export const LOOKBACK_POST_DAYS = 120;
export const ACCOUNT_LOOKBACK_DAYS = 3;
const DAY_MS = 86400e3;

export interface OrganicDeps { store: SocialStore; gateway: OrganicGateway; now: () => Date; log?: { warn(m: string, f?: Record<string, unknown>): void } }
export interface OrganicConn extends Scope { igUserId?: string; pageId?: string }

export interface PlatformResult { platform: SocialPlatform; posts: number; metrics: number; rejected: number; partial: boolean }

export async function syncPlatform(d: OrganicDeps, c: OrganicConn, platform: SocialPlatform, reject: (r: string) => void): Promise<PlatformResult> {
  const now = d.now(), nowIso = now.toISOString(), today = istDay(now);
  const out: PlatformResult = { platform, posts: 0, metrics: 0, rejected: 0, partial: false };
  const profile = await d.gateway.profile(platform);
  const acct = await d.store.ensureAccount({ ...c, platform, externalId: profile.externalId, displayName: profile.displayName, username: profile.username, followers: profile.followers, at: nowIso });

  try {
    // 1. new posts (+ live stories), incremental
    const since = acct.lastPostAt ? new Date(Date.parse(acct.lastPostAt) - OVERLAP_DAYS * DAY_MS).toISOString() : new Date(now.getTime() - BACKFILL_DAYS * DAY_MS).toISOString();
    const seen = new Map<string, RemotePost>();
    let after: string | undefined;
    for (let i = 0; i < MAX_POST_PAGES; i++) {
      const page = await d.gateway.posts(platform, { since, after });
      for (const p of page.items) seen.set(p.externalId, p);
      after = page.after;
      if (!after) break;
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
          out.rejected++; reject("post_metrics_failed");
        }
      }
    } finally { await flush(); }

    // 4. account trend: re-read the trailing days (Meta restates)
    try {
      const days = await d.gateway.accountDays(platform, { since: addDays(today, -ACCOUNT_LOOKBACK_DAYS), until: today });
      const withTotal = days.map((r, i) => (i === days.length - 1 && r.followers === null && profile.followers !== null ? { ...r, followers: profile.followers } : r));
      if (withTotal.length) await d.store.upsertAccountMetrics(withTotal.map((r) => ({ ...r, accountId: acct.id, at: nowIso })), c);
    } catch (e) {
      if (e instanceof CredentialError) throw e;
      if (e instanceof TransientError) out.partial = true; else { out.rejected++; reject("account_metrics_failed"); }
    }
    await d.store.markSynced(acct.id, { at: nowIso, status: out.partial || out.rejected > 0 ? "partial" : "ok" });
  } catch (e) {
    if (e instanceof CredentialError) { await d.store.markSynced(acct.id, { at: nowIso, status: "needs_attention", error: "Meta rejected the saved credentials" }).catch(() => undefined); throw e; }
    await d.store.markSynced(acct.id, { at: nowIso, status: "error", error: e instanceof TransientError ? "Meta is busy or unreachable" : "Sync stopped" }).catch(() => undefined);
    throw e;
  }
  return out;
}

export async function organicStep(d: OrganicDeps, c: OrganicConn, reject: (r: string) => void): Promise<SyncResult> {
  const platforms: SocialPlatform[] = [...(c.igUserId ? ["instagram" as const] : []), ...(c.pageId ? ["facebook" as const] : [])];
  if (!platforms.length) return { cursor: null, rowsIn: 0, rowsRejected: 0, done: true, sample: { skipped: "no_accounts" } };
  const results: PlatformResult[] = [];
  let transient = false;
  for (const p of platforms) {
    try { results.push(await syncPlatform(d, c, p, reject)); }
    catch (e) { if (e instanceof TransientError) { transient = true; continue; } throw e; }
  }
  return {
    cursor: { at: d.now().toISOString() }, rowsIn: results.reduce((s, r) => s + r.posts + r.metrics, 0), rowsRejected: results.reduce((s, r) => s + r.rejected, 0),
    done: true, sample: { mode: d.gateway.kind, platforms: results.map((r) => ({ p: r.platform, posts: r.posts, metrics: r.metrics })), pending: transient || results.some((r) => r.partial) },
  };
}
