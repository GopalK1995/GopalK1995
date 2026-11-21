// Graph API gateway for organic posts and insights. Same transport rules as the Meta ads connector: retries 429/5xx and Meta's
// rate-limit codes (HTTP 400 with code 4/17/32/613/80001...) with exponential backoff, honours Retry-After, keeps the vendor code,
// never logs bodies or tokens, signs calls with appsecret_proof when the app secret is known.
import { backoffMs, parseRetryAfter } from "../../core/http";
import { CredentialError, DEFAULT_RATE_POLICY, TransientError, type RateLimitPolicy } from "../../core/types";
import { appSecretProof } from "../../meta-ads/graph";
import { errorFromResponse, MetaApiError } from "../../meta-ads/gateway";
import {
  mapAccountInsights, mapFbPost, mapFbPostFields, mapFbPostInsights, mapIgMedia, mapIgPostInsights, count,
} from "./mappers";
import type { AccountDay, OrganicGateway, Page, PostKind, PostMetrics, RemotePost, RemoteProfile, SocialPlatform } from "./types";

export interface OrganicGraphOpts {
  apiBase: string; version: string; pageToken?: string; pageId?: string; igUserId?: string; appSecret?: string;
  fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; random?: () => number; policy?: Partial<RateLimitPolicy>;
}
type R = Record<string, unknown>;
const isObj = (v: unknown): v is R => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const afterOf = (j: R): string | undefined => (isObj(j.paging) && typeof j.paging.next === "string" && isObj(j.paging.cursors) && typeof j.paging.cursors.after === "string" ? j.paging.cursors.after.slice(0, 500) : undefined);
const unix = (iso: string): string => String(Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000));

const IG_MEDIA_FIELDS = "id,caption,media_type,media_product_type,permalink,media_url,thumbnail_url,timestamp";
const FB_POST_FIELDS = "id,message,permalink_url,created_time,full_picture,attachments{media_type},reactions.summary(true).limit(0),comments.summary(true).limit(0),shares";
export const PAGE_SIZE = 50;

/** Instagram media insights metric list by kind. Asking for a metric a type does not support fails the whole call, so it is per kind. */
export function igMetricsFor(kind: PostKind): string {
  switch (kind) {
    case "story": return "reach,views,shares";
    case "reel": return "reach,views,likes,comments,shares,saved";
    case "video": return "reach,views,likes,comments,shares,saved";
    default: return "reach,views,likes,comments,shares,saved";
  }
}

export function makeOrganicGraph(o: OrganicGraphOpts): OrganicGateway {
  const p = { ...DEFAULT_RATE_POLICY, ...o.policy };
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = `${o.apiBase.replace(/\/+$/, "")}/${o.version}`;
  const token = (): string => { if (!o.pageToken) throw new CredentialError("Meta page token is missing"); return o.pageToken; };
  const ig = (): string => { if (!o.igUserId) throw new CredentialError("No Instagram account is connected"); return o.igUserId; };
  const page = (): string => { if (!o.pageId) throw new CredentialError("No Facebook Page is connected"); return o.pageId; };

  async function get<T = R>(path: string, query: Record<string, string | undefined>): Promise<T> {
    const t = token();
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) q.set(k, v);
    if (o.appSecret) q.set("appsecret_proof", appSecretProof(t, o.appSecret));
    const url = `${base}/${path.replace(/^\/+/, "")}?${q.toString()}`;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try { res = await doFetch(url, { method: "GET", headers: { accept: "application/json", authorization: `Bearer ${t}` } }); }
      catch {
        if (attempt >= p.maxRetries) throw new TransientError("Meta API unreachable");
        await sleep(backoffMs(attempt, p, o.random));
        continue;
      }
      if (res.ok) return (await res.json()) as T;
      let body: unknown = null;
      try { body = await res.json(); } catch { /* no body */ }
      const err = errorFromResponse(res.status, body);
      if (err instanceof MetaApiError && err.transient) {
        const ra = parseRetryAfter(res.headers.get("retry-after"));
        if (attempt >= p.maxRetries) throw new TransientError(`Meta API kept failing (code ${err.code || res.status})`, ra);
        await sleep(Math.min(p.maxDelayMs, ra ?? backoffMs(attempt, p, o.random)));
        continue;
      }
      throw err;
    }
  }
  /** Insights Meta refuses for one post (too old, account converted, removed) are "no data", not a failed sync. */
  const noData = (e: unknown): boolean => e instanceof MetaApiError && (e.failure === "not_found" || e.failure === "permission" || e.code === 100 || e.code === 10);

  return {
    kind: "graph",
    async profile(plat): Promise<RemoteProfile> {
      if (plat === "instagram") {
        const j = await get(ig(), { fields: "id,username,name,followers_count" });
        const username = typeof j.username === "string" ? j.username.slice(0, 120) : null;
        return { externalId: ig(), displayName: typeof j.name === "string" && j.name ? j.name.slice(0, 120) : username, username, followers: count(j.followers_count) };
      }
      const j = await get(page(), { fields: "id,name,followers_count,fan_count" });
      return { externalId: page(), displayName: typeof j.name === "string" ? j.name.slice(0, 120) : null, username: null, followers: count(j.followers_count) ?? count(j.fan_count) };
    },
    async posts(plat, i): Promise<Page<RemotePost>> {
      if (plat === "instagram") {
        const j = await get(`${ig()}/media`, { fields: IG_MEDIA_FIELDS, limit: String(PAGE_SIZE), after: i.after, since: i.since ? String(Math.floor(Date.parse(i.since) / 1000)) : undefined });
        return { items: arr(j.data).map((x) => mapIgMedia(x)).filter((x): x is RemotePost => !!x), after: afterOf(j) };
      }
      const j = await get(`${page()}/published_posts`, { fields: FB_POST_FIELDS, limit: String(PAGE_SIZE), after: i.after, since: i.since ? String(Math.floor(Date.parse(i.since) / 1000)) : undefined });
      return { items: arr(j.data).map(mapFbPost).filter((x): x is RemotePost => !!x), after: afterOf(j) };
    },
    async stories(plat): Promise<RemotePost[]> {
      if (plat !== "instagram") return [];
      const j = await get(`${ig()}/stories`, { fields: IG_MEDIA_FIELDS });
      return arr(j.data).map((x) => mapIgMedia(x, true)).filter((x): x is RemotePost => !!x);
    },
    async postMetrics(plat, post): Promise<PostMetrics | null> {
      try {
        if (plat === "instagram") return mapIgPostInsights(await get(`${post.externalId}/insights`, { metric: igMetricsFor(post.kind) }), post.kind);
        const inline = post.inline ?? mapFbPostFields(await get(post.externalId, { fields: "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares" }));
        return mapFbPostInsights(await get(`${post.externalId}/insights`, { metric: "post_impressions,post_impressions_unique,post_clicks" }), inline);
      } catch (e) { if (noData(e)) return null; throw e; }
    },
    async accountDays(plat, i): Promise<AccountDay[]> {
      try {
        if (plat === "instagram") {
          const j = await get(`${ig()}/insights`, { metric: "reach,profile_views,website_clicks,follower_count", period: "day", since: unix(i.since), until: unix(i.until) });
          return mapAccountInsights(j);
        }
        const j = await get(`${page()}/insights`, { metric: "page_impressions_unique,page_daily_follows_unique,page_follows", period: "day", since: unix(i.since), until: unix(i.until) });
        return mapAccountInsights(j);
      } catch (e) { if (noData(e)) return []; throw e; }
    },
  };
}

export type { SocialPlatform };
