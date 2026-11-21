// Pure mappers for the Graph API insights responses (Instagram + Facebook), plus the small rules the sync and the page share:
// engagement-rate math, the story window and the metrics refresh schedule. Never throws; never turns "unknown" into 0.
import { EMPTY_METRICS, type AccountDay, type PostKind, type PostMetrics, type PostStatus, type RemotePost, type StoredPost } from "./types";

type R = Record<string, unknown>;
const isObj = (v: unknown): v is R => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const DAY_MS = 86400e3;
export const STORY_WINDOW_MS = DAY_MS;
export const FRESH_DAYS = 30;
export const WEEKLY_MS = 7 * DAY_MS;

/** A finite, non-negative whole count, or null. Numeric strings are accepted; objects (breakdowns), NaN and negatives are not counts. */
export function count(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
/** Like count but a signed delta (follower change). */
export function signed(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Reads the value of one insights entry: `values[0].value` (period metrics) or `total_value.value` (aggregate metrics). */
function entryValue(e: R): unknown {
  if (isObj(e.total_value)) return e.total_value.value;
  const v0 = arr(e.values)[0];
  return isObj(v0) ? v0.value : undefined;
}
/** Insights response -> metric name -> raw value. Later duplicates do not override the first. */
export function insightMap(raw: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const data = isObj(raw) ? raw.data : raw;
  for (const e of arr(data)) {
    if (!isObj(e) || typeof e.name !== "string" || out.has(e.name)) continue;
    out.set(e.name, entryValue(e));
  }
  return out;
}
const pick = (m: Map<string, unknown>, ...names: string[]): number | null => {
  for (const n of names) if (m.has(n)) { const c = count(m.get(n)); if (c !== null) return c; }
  return null;
};

/**
 * Instagram media insights. Meta renamed metrics across API versions, so the aliases are accepted:
 * impressions | views, saved | saves, plays | video_views | (views on a reel or video). Unreported metrics stay null.
 */
export function mapIgPostInsights(raw: unknown, kind: PostKind): PostMetrics {
  const m = insightMap(raw);
  const isVideo = kind === "reel" || kind === "video";
  const views = pick(m, "views");
  return {
    impressions: pick(m, "impressions") ?? (isVideo ? null : views),
    reach: pick(m, "reach"),
    likes: pick(m, "likes"),
    comments: pick(m, "comments"),
    shares: pick(m, "shares"),
    saves: pick(m, "saved", "saves"),
    videoViews: pick(m, "plays", "video_views") ?? (isVideo ? views : null),
    // Stories: taps forward are not link clicks; only an explicit link metric counts.
    linkClicks: pick(m, "link_clicks", "website_clicks"),
  };
}

/** Facebook post: reactions / comments / shares come as summary objects on the post itself, reach and impressions from insights. */
export function mapFbPostFields(raw: unknown): Partial<PostMetrics> {
  if (!isObj(raw)) return {};
  const total = (x: unknown): number | null => (isObj(x) && isObj(x.summary) ? count(x.summary.total_count) : null);
  const shares = isObj(raw.shares) ? count(raw.shares.count) : null;   // Meta omits `shares` when there are none: unknown, not 0
  return { likes: total(raw.reactions), comments: total(raw.comments), shares };
}
export function mapFbPostInsights(raw: unknown, inline: Partial<PostMetrics> = {}): PostMetrics {
  const m = insightMap(raw);
  return {
    ...EMPTY_METRICS,
    impressions: pick(m, "post_impressions"),
    reach: pick(m, "post_impressions_unique", "post_reach"),
    likes: inline.likes ?? pick(m, "post_reactions_like_total"),
    comments: inline.comments ?? null,
    shares: inline.shares ?? null,
    videoViews: pick(m, "post_video_views"),
    linkClicks: pick(m, "post_clicks_by_type") ?? pick(m, "post_clicks"),
  };
}

/** Instagram media type -> product kind. Stories and reels are told apart by the product type; CAROUSEL_ALBUM is a carousel. */
export function igKind(mediaType: unknown, productType: unknown, fromStories = false): PostKind {
  const p = String(productType ?? "").toUpperCase(), t = String(mediaType ?? "").toUpperCase();
  if (fromStories || p === "STORY") return "story";
  if (p === "REELS" || p === "REEL") return "reel";
  if (t === "CAROUSEL_ALBUM") return "carousel";
  if (t === "VIDEO") return "video";
  return "feed";
}
export function fbKind(attachmentType: unknown): PostKind {
  const t = String(attachmentType ?? "").toLowerCase();
  if (t.includes("video")) return "video";
  if (t.includes("album") || t.includes("multi")) return "carousel";
  return "feed";
}

const iso = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));   // Graph writes +0000, not +00:00
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length ? v.slice(0, max) : null);

export function mapIgMedia(raw: unknown, fromStories = false): RemotePost | null {
  if (!isObj(raw)) return null;
  const id = text(raw.id, 96), postedAt = iso(raw.timestamp);
  if (!id || !postedAt) return null;
  return {
    externalId: id, kind: igKind(raw.media_type, raw.media_product_type, fromStories), caption: text(raw.caption, 2200), permalink: text(raw.permalink, 500),
    mediaUrl: text(raw.thumbnail_url, 1000) ?? text(raw.media_url, 1000), postedAt,
  };
}
export function mapFbPost(raw: unknown): RemotePost | null {
  if (!isObj(raw)) return null;
  const id = text(raw.id, 96), postedAt = iso(raw.created_time);
  if (!id || !postedAt) return null;
  const att = isObj(raw.attachments) ? arr(raw.attachments.data)[0] : undefined;
  return {
    externalId: id, kind: fbKind(isObj(att) ? att.media_type : undefined), caption: text(raw.message, 2200), permalink: text(raw.permalink_url, 500),
    mediaUrl: text(raw.full_picture, 1000), postedAt, inline: mapFbPostFields(raw),
  };
}

/**
 * Account insights (period=day) -> one row per day. Entries are `{name, values:[{value, end_time}]}`; `end_time` is the END of the
 * reported day, so the value belongs to the previous calendar day (UTC date of end_time minus one day).
 */
export function mapAccountInsights(raw: unknown, followers: number | null = null): AccountDay[] {
  const byDay = new Map<string, AccountDay>();
  const row = (day: string): AccountDay => { let r = byDay.get(day); if (!r) { r = { day, followers: null, followerDelta: null, profileViews: null, reach: null, websiteClicks: null }; byDay.set(day, r); } return r; };
  const data = isObj(raw) ? raw.data : raw;
  for (const e of arr(data)) {
    if (!isObj(e) || typeof e.name !== "string") continue;
    for (const v of arr(e.values)) {
      if (!isObj(v)) continue;
      const end = iso(v.end_time);
      if (!end) continue;
      const day = new Date(Date.parse(end) - DAY_MS).toISOString().slice(0, 10);
      const r = row(day);
      switch (e.name) {
        case "reach": case "page_impressions_unique": r.reach = count(v.value); break;
        case "profile_views": case "page_views_total": r.profileViews = count(v.value); break;
        case "website_clicks": case "page_website_clicks_logged_in_unique": r.websiteClicks = count(v.value); break;
        case "follower_count": case "page_daily_follows_unique": r.followerDelta = signed(v.value); break;
        case "page_fans": case "page_follows": r.followers = count(v.value); break;
      }
    }
  }
  const out = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  if (followers !== null && out.length) {
    const last = out[out.length - 1]!;
    if (last.followers === null) last.followers = followers;   // today's total belongs to the latest reported day only
  }
  return out;
}

/** Interactions / reach, or null when reach is unknown or zero or no interaction count is known. Matches the SQL generated column. */
export function engagementRate(m: Pick<PostMetrics, "reach" | "likes" | "comments" | "shares" | "saves">): number | null {
  if (m.reach === null || m.reach <= 0) return null;
  if (m.likes === null && m.comments === null && m.shares === null && m.saves === null) return null;
  const n = (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
  return Math.round((n / m.reach) * 1e4) / 1e4;
}


/** A story is readable for 24 hours; after that it is `expired` (metrics captured while it was live stay in the daily table). */
export function storyStatus(postedAt: string, now: Date): PostStatus {
  return now.getTime() - Date.parse(postedAt) < STORY_WINDOW_MS ? "live" : "expired";
}
export function postStatus(post: Pick<RemotePost, "kind" | "postedAt">, now: Date): PostStatus {
  return post.kind === "story" ? storyStatus(post.postedAt, now) : "live";
}
/**
 * Metrics are re-fetched on every sync for posts younger than 30 days, then weekly. Stories only while live (the 24 h window);
 * an expired story is never asked again. Deleted posts are skipped.
 */
export function shouldRefreshMetrics(p: Pick<StoredPost, "kind" | "postedAt" | "status" | "lastMetricsAt">, now: Date): boolean {
  if (p.status === "deleted") return false;
  const age = now.getTime() - Date.parse(p.postedAt);
  if (p.kind === "story") return age < STORY_WINDOW_MS;
  if (!p.lastMetricsAt) return true;
  if (age < FRESH_DAYS * DAY_MS) return true;
  return now.getTime() - Date.parse(p.lastMetricsAt) >= WEEKLY_MS;
}

/** True when at least one metric is a real number (an all-null result is "Meta had nothing", kept as nulls). */
export const hasAnyMetric = (m: PostMetrics): boolean => Object.values(m).some((v) => v !== null);
