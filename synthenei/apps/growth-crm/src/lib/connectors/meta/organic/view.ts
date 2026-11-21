// Read model for /analytics/social. Pure: rows in, view out (unit-tested). Never turns a null metric into 0.
import { engagementRate } from "./mappers";
import { EMPTY_METRICS, type PostKind, type PostMetrics, type PostStatus, type SocialPlatform } from "./types";

export type SocialState = "ready" | "empty" | "not_connected" | "needs_vendor_approval" | "needs_attention" | "permission_denied" | "error";

export interface SeriesPoint { day: string; reach: number | null; impressions: number | null; engagement: number | null }
export interface SocialPostView {
  id: string; accountId: string; platform: SocialPlatform; accountName: string; kind: PostKind; caption: string | null; permalink: string | null;
  postedAt: string; status: PostStatus; metrics: PostMetrics; engagement: number | null; series: SeriesPoint[];
}
export interface SocialAccountView { id: string; platform: SocialPlatform; name: string; username: string | null; followers: number | null; lastSyncedAt: string | null; status: string | null; lastError: string | null }
export interface TrendDay { day: string; followers: number | null; reach: number | null }
export interface SocialView {
  state: SocialState; demo: boolean; errorSource?: string; accounts: SocialAccountView[]; posts: SocialPostView[]; trend: TrendDay[];
  /** Posts that have at least one real metric / all posts, for the partial state. */
  synced: { done: number; total: number }; connectionId: string | null; missingScopes: string[]; lastSyncedAt: string | null;
}

type R = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export interface Raw {
  accounts: R[]; posts: R[]; postMetrics: R[]; accountMetrics: R[];
  /** meta-ads connections of the workspace: id, status, oauth_scopes. */
  connections: { id: string; status: string; scopes: string[] }[];
  /** Outcome the last social run reported (skipped reason + missing scopes), if readable. */
  lastSkip?: { skipped?: string; missing?: string[] } | null;
}

export const metricsOfRow = (m: R): PostMetrics => ({
  impressions: num(m.impressions), reach: num(m.reach), likes: num(m.likes), comments: num(m.comments), shares: num(m.shares),
  saves: num(m.saves), videoViews: num(m.video_views), linkClicks: num(m.link_clicks),
});
const anyMetric = (m: PostMetrics): boolean => Object.values(m).some((v) => v !== null);

export function assembleView(raw: Raw, opts: { demo?: boolean } = {}): SocialView {
  const base = { demo: opts.demo === true, accounts: [] as SocialAccountView[], posts: [] as SocialPostView[], trend: [] as TrendDay[], synced: { done: 0, total: 0 }, connectionId: raw.connections[0]?.id ?? null, missingScopes: [] as string[], lastSyncedAt: null as string | null };
  const live = raw.connections.filter((c) => c.status !== "disconnected" && c.status !== "not_configured");
  if (!opts.demo && !live.length && !raw.accounts.length) return { ...base, state: "not_connected" };

  const accounts: SocialAccountView[] = raw.accounts.map((a) => ({
    id: String(a.id), platform: a.platform as SocialPlatform, name: str(a.display_name) ?? str(a.username) ?? String(a.external_id), username: str(a.username),
    followers: num(a.followers), lastSyncedAt: str(a.last_synced_at), status: str(a.last_sync_status), lastError: str(a.last_error),
  }));
  const byAccount = new Map(accounts.map((a) => [a.id, a]));
  const series = new Map<string, SeriesPoint[]>();
  const latest = new Map<string, PostMetrics>();
  for (const m of [...raw.postMetrics].sort((a, b) => String(a.day).localeCompare(String(b.day)))) {
    const id = String(m.post_id), pm = metricsOfRow(m), eng = num(m.engagement_rate);
    (series.get(id) ?? series.set(id, []).get(id)!).push({ day: String(m.day), reach: pm.reach, impressions: pm.impressions, engagement: eng });
    latest.set(id, pm);   // ascending by day: the last write is the newest snapshot
  }
  const posts: SocialPostView[] = raw.posts.flatMap((p) => {
    const acct = byAccount.get(String(p.account_id));
    if (!acct) return [];
    const metrics = latest.get(String(p.id)) ?? EMPTY_METRICS;
    return [{
      id: String(p.id), accountId: acct.id, platform: acct.platform, accountName: acct.name, kind: p.kind as PostKind, caption: str(p.caption), permalink: str(p.permalink),
      postedAt: String(p.posted_at), status: p.status as PostStatus, metrics, engagement: engagementRate(metrics), series: series.get(String(p.id)) ?? [],
    }];
  }).sort((a, b) => b.postedAt.localeCompare(a.postedAt));

  const trendMap = new Map<string, TrendDay>();
  for (const r of raw.accountMetrics) {
    const day = String(r.day), t = trendMap.get(day) ?? { day, followers: null, reach: null };
    const f = num(r.followers), re = num(r.reach);
    if (f !== null) t.followers = (t.followers ?? 0) + f;
    if (re !== null) t.reach = (t.reach ?? 0) + re;
    trendMap.set(day, t);
  }
  const lastSyncedAt = accounts.map((a) => a.lastSyncedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const synced = { done: posts.filter((p) => anyMetric(p.metrics)).length, total: posts.length };
  const common = { ...base, accounts, posts, trend: [...trendMap.values()].sort((a, b) => a.day.localeCompare(b.day)), synced, lastSyncedAt };

  if (!opts.demo) {
    if (live.some((c) => c.status === "needs_attention") || accounts.some((a) => a.status === "needs_attention")) return { ...common, state: "needs_attention" };
    if (raw.lastSkip?.skipped === "needs_vendor_approval") return { ...common, state: "needs_vendor_approval", missingScopes: raw.lastSkip.missing ?? [] };
    const missing = live.flatMap((c) => (c.scopes.length && !c.scopes.includes("instagram_manage_insights") ? ["instagram_manage_insights"] : []));
    if (!accounts.length && missing.length) return { ...common, state: "needs_vendor_approval", missingScopes: missing };
  }
  return { ...common, state: posts.length || accounts.length ? "ready" : "empty" };
}
