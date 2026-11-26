// SocialStore on the SERVICE-ROLE client (the sync job is the only writer; clients can only read, RLS analytics.read).
// RLS does not protect this path, so every query is scoped by account id / tenant / workspace. Upserts hit the unique keys
// (workspace, platform, external_id), (account, external_id), (post, day), (account, day), so a re-run replaces rather than doubles.
import "server-only";
import type { Db } from "@/lib/db/client";
import { from, type Qb } from "@/lib/db/query";
import type { PostMetrics, PostKind, PostStatus, SocialStore, StoredPost } from "./types";

type R = Record<string, unknown>;
const failed = (what: string) => new Error(`social store: ${what} failed`);   // PostgREST text can quote values: not echoed
const CHUNK = 200;
type Upsertable = { from(t: string): { upsert(v: R[], o: { onConflict: string }): PromiseLike<{ error: { code?: string } | null }> } };

export const metricsColumns = (m: PostMetrics): R => ({
  impressions: m.impressions, reach: m.reach, likes: m.likes, comments: m.comments, shares: m.shares, saves: m.saves, video_views: m.videoViews, link_clicks: m.linkClicks,
});

export function supabaseSocialStore(db: Db): SocialStore {
  const q = (t: string): Qb => from(db, t);
  const rows = async (b: Qb, what: string): Promise<R[]> => { const { data, error } = await b; if (error) throw failed(what); return (data as R[] | null) ?? []; };
  const upsert = async (table: string, data: R[], onConflict: string, what: string) => {
    for (let i = 0; i < data.length; i += CHUNK) {
      const { error } = await (db as unknown as Upsertable).from(table).upsert(data.slice(i, i + CHUNK), { onConflict });
      if (error) throw failed(what);
    }
  };
  return {
    async ensureAccount(i) {
      const row = { tenant_id: i.tenantId, workspace_id: i.workspaceId, integration_id: i.connectionId, platform: i.platform, external_id: i.externalId, display_name: i.displayName, username: i.username, followers: i.followers, updated_at: i.at };
      await upsert("social_accounts", [row], "workspace_id,platform,external_id", "account upsert");
      const a = (await rows(q("social_accounts").select("id").eq("workspace_id", i.workspaceId).eq("platform", i.platform).eq("external_id", i.externalId).limit(1), "account read"))[0];
      if (!a) throw failed("account read");
      // Stories are not "the newest post": a fresh story used to move the cut-off past every older feed post and reel, which were then never read (INTG-010).
      const last = (await rows(q("social_posts").select("posted_at").eq("account_id", a.id).neq("kind", "story").order("posted_at", { ascending: false }).limit(1), "last post"))[0];
      return { id: String(a.id), lastPostAt: typeof last?.posted_at === "string" ? last.posted_at : null };
    },
    async upsertPosts(i) {
      await upsert("social_posts", i.posts.map((p) => ({
        tenant_id: i.tenantId, workspace_id: i.workspaceId, account_id: i.accountId, external_id: p.externalId, kind: p.kind, caption: p.caption, permalink: p.permalink,
        media_url: p.mediaUrl, posted_at: p.postedAt, status: p.status,
      })), "account_id,external_id", "post upsert");
    },
    async listPosts(accountId, sinceIso) {
      const posts = await rows(q("social_posts").select("id, external_id, kind, posted_at, status").eq("account_id", accountId).gte("posted_at", sinceIso).order("posted_at", { ascending: false }).limit(1000), "post list");
      const last = new Map<string, { at: string; has: boolean }>();
      const ids = posts.map((p) => String(p.id));
      for (let i = 0; i < ids.length; i += CHUNK) {
        for (const m of await rows(q("social_post_metrics_daily").select("post_id, captured_at, impressions, reach, likes, comments, shares, saves, video_views, link_clicks").in("post_id", ids.slice(i, i + CHUNK)), "metrics list")) {
          const id = String(m.post_id), at = String(m.captured_at), has = ["impressions", "reach", "likes", "comments", "shares", "saves", "video_views", "link_clicks"].some((k) => m[k] !== null && m[k] !== undefined);
          const cur = last.get(id);
          last.set(id, { at: cur && cur.at > at ? cur.at : at, has: (cur?.has ?? false) || has });
        }
      }
      return posts.map((p): StoredPost => ({
        id: String(p.id), externalId: String(p.external_id), kind: p.kind as PostKind, postedAt: String(p.posted_at), status: p.status as PostStatus,
        lastMetricsAt: last.get(String(p.id))?.at ?? null, hasMetrics: last.get(String(p.id))?.has ?? false,
      }));
    },
    async setPostStatus(postId, status) { await rows(q("social_posts").update({ status }).eq("id", postId).select("id"), "post status"); },
    async upsertPostMetrics(r, s) {
      await upsert("social_post_metrics_daily", r.map((x) => ({ tenant_id: s.tenantId, workspace_id: s.workspaceId, post_id: x.postId, day: x.day, ...metricsColumns(x.metrics), captured_at: x.at })), "post_id,day", "metrics upsert");
    },
    async upsertAccountMetrics(r, s) {
      await upsert("social_account_metrics_daily", r.map((x) => ({
        tenant_id: s.tenantId, workspace_id: s.workspaceId, account_id: x.accountId, day: x.day, followers: x.followers, follower_delta: x.followerDelta,
        profile_views: x.profileViews, reach: x.reach, website_clicks: x.websiteClicks, captured_at: x.at,
      })), "account_id,day", "account metrics upsert");
    },
    async markSynced(accountId, r) {
      try { await rows(q("social_accounts").update({ last_synced_at: r.at, last_sync_status: r.status, last_error: r.error ?? null }).eq("id", accountId).select("id"), "account status"); }
      catch (e) {
        // 'no_data' needs migration 0025 (check constraint). Until it is applied it is stored as 'partial' (never 'ok') with the same note.
        if (r.status !== "no_data") throw e;
        await rows(q("social_accounts").update({ last_synced_at: r.at, last_sync_status: "partial", last_error: r.error ?? "No data from Meta" }).eq("id", accountId).select("id"), "account status");
      }
    },
  };
}
