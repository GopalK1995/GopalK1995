// AUD-028 / INTG-008..010,040: what the organic sync records when Meta gives nothing, refuses a metric or hides older posts.
// Fixture based: no network. The Graph call shapes asserted here are the ones the code SENDS; Meta accepting them is UNVERIFIED until a real run.
import { describe, expect, it } from "vitest";
import { CredentialError } from "../../../core/types";
import { makeOrganicGraph, igMetricsFor } from "../graph";
import { organicStep } from "../sync";
import { EMPTY_METRICS, type AccountDay, type OrganicGateway, type PostMetrics, type RemotePost, type SocialStore, type StoredPost } from "../types";

const NOW = new Date("2026-11-26T09:30:00Z");
const h = (hours: number) => new Date(NOW.getTime() - hours * 3600e3).toISOString();
const C = { tenantId: "t1", workspaceId: "w1", connectionId: "c1", igUserId: "ig1", pageId: "pg1" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const gerr = (code: number, subcode = 0, status = 400) => json({ error: { message: "x", type: "OAuthException", code, error_subcode: subcode } }, status);

describe("graph transport: account insights", () => {
  const make = (handler: (url: URL) => Response) => {
    const urls: URL[] = [];
    const fetch = (async (u: string) => { const url = new URL(u); urls.push(url); return handler(url); }) as unknown as typeof globalThis.fetch;
    return { urls, g: makeOrganicGraph({ apiBase: "https://g.test", version: "v21.0", pageToken: "T", pageId: "pg1", igUserId: "ig1", fetch, sleep: async () => undefined }) };
  };
  const ok = (url: URL) => {
    const metric = url.searchParams.get("metric")!;
    if (url.searchParams.get("metric_type") === "total_value") return json({ data: [{ name: metric, total_value: { value: 7 } }] });
    return json({ data: [{ name: metric, values: [{ value: 5, end_time: "2026-11-25T08:00:00+0000" }] }] });
  };

  it("never mixes time_series and total_value metrics in one call, and sends metric_type=total_value for profile_views / website_clicks", async () => {
    const { g, urls } = make(ok);
    const days = await g.accountDays("instagram", { since: "2026-11-24", until: "2026-11-26" });
    for (const u of urls) expect(u.searchParams.get("metric")!.includes(",")).toBe(false);
    const totals = urls.filter((u) => u.searchParams.get("metric_type") === "total_value").map((u) => u.searchParams.get("metric"));
    expect(totals).toContain("profile_views");
    expect(totals).toContain("website_clicks");
    expect(urls.filter((u) => ["reach", "follower_count"].includes(u.searchParams.get("metric")!)).every((u) => u.searchParams.get("period") === "day")).toBe(true);
    expect(days.find((d) => d.day === "2026-11-24")?.profileViews).toBe(7);   // a per-day total lands on the day it was asked for
  });
  it("one refused metric group (code 100) is reported and the others still land", async () => {
    const { g } = make((u) => (u.searchParams.get("metric") === "follower_count" ? gerr(100) : ok(u)));
    const seen: string[] = [];
    const days = await g.accountDays("instagram", { since: "2026-11-25", until: "2026-11-26" }, (m, c) => seen.push(`${m}:${c}`));
    expect(seen).toEqual(["follower_count:100"]);
    expect(days.some((d) => d.reach === 5)).toBe(true);
  });
  it("when every group fails the call throws with the Graph code (never an empty success)", async () => {
    const { g } = make(() => gerr(100));
    await expect(g.accountDays("instagram", { since: "2026-11-25", until: "2026-11-26" })).rejects.toMatchObject({ code: 100 });
  });
  it("Instagram media is read without a since filter (cursor paging, newest first)", async () => {
    const { g, urls } = make(() => json({ data: [] }));
    await g.posts("instagram", { since: "2026-11-01T00:00:00Z" });
    expect(urls[0]!.pathname).toContain("/ig1/media");
    expect(urls[0]!.searchParams.has("since")).toBe(false);
    expect(urls[0]!.searchParams.get("fields")).toContain("media_product_type");
  });
  it("post insights: code 100 / 10 now propagate; only 'older than the business conversion' (subcode 2108006) is no data", async () => {
    const a = make(() => gerr(100));
    await expect(a.g.postMetrics("instagram", { externalId: "m1", kind: "feed" })).rejects.toMatchObject({ code: 100 });
    const b = make(() => gerr(10));
    await expect(b.g.postMetrics("instagram", { externalId: "m1", kind: "feed" })).rejects.toBeInstanceOf(CredentialError);   // Graph code 10 = a permission the connection lacks: needs_attention, never swallowed
    const c = make(() => gerr(100, 2108006));
    expect(await c.g.postMetrics("instagram", { externalId: "m1", kind: "feed" })).toBeNull();
  });
  it("metric lists differ by kind", () => { expect(igMetricsFor("story")).not.toContain("likes"); expect(igMetricsFor("reel")).toContain("saved"); });
});

class Mem implements SocialStore {
  posts: { id: string; p: RemotePost }[] = []; am: (AccountDay & { accountId: string })[] = []; status: { status: string; error?: string | null }[] = [];
  seedLast: string | null = null;
  async ensureAccount() { return { id: "a1", lastPostAt: this.seedLast }; }
  async upsertPosts(i: Parameters<SocialStore["upsertPosts"]>[0]) { for (const p of i.posts) if (!this.posts.some((x) => x.p.externalId === p.externalId)) this.posts.push({ id: `p${this.posts.length + 1}`, p }); }
  async listPosts(): Promise<StoredPost[]> { return this.posts.map((x) => ({ id: x.id, externalId: x.p.externalId, kind: x.p.kind, postedAt: x.p.postedAt, status: "live", lastMetricsAt: null, hasMetrics: false })); }
  async setPostStatus() { /* not needed */ }
  async upsertPostMetrics() { /* not needed */ }
  async upsertAccountMetrics(r: (AccountDay & { accountId: string })[]) { this.am.push(...r); }
  async markSynced(_id: string, r: { status: string; error?: string | null }) { this.status.push(r); }
}
const rp = (id: string, hoursAgo: number, kind: RemotePost["kind"] = "feed"): RemotePost => ({ externalId: id, kind, caption: null, permalink: null, mediaUrl: null, postedAt: h(hoursAgo) });
const M = (): PostMetrics => ({ ...EMPTY_METRICS, reach: 10, likes: 1 });
const gw = (o: { posts?: RemotePost[]; stories?: RemotePost[]; followers?: number | null; days?: () => AccountDay[]; seen?: { since?: string }[] }): OrganicGateway => ({
  kind: "fake",
  async profile(p) { return { externalId: p === "instagram" ? "ig1" : "pg1", displayName: "A", username: null, followers: o.followers === undefined ? 572 : o.followers }; },
  async posts(p, i) { o.seen?.push({ since: i.since }); return { items: p === "instagram" ? (o.posts ?? []) : [] }; },
  async stories(p) { return p === "instagram" ? (o.stories ?? []) : []; },
  async postMetrics() { return M(); },
  async accountDays(_p, _i, report) { if (o.days) return o.days(); report?.("follower_count", 100); return []; },
});
const igOnly = { ...C, pageId: undefined };
const goodDay: AccountDay = { day: "2026-11-25", followers: 572, followerDelta: 1, profileViews: 1, reach: 1, websiteClicks: 0 };

describe("organic sync honesty", () => {
  it("first run reaches back past a month: an old feed post is fetched, not hidden by a 30 day window", async () => {
    const st = new Mem(), seen: { since?: string }[] = [];
    await organicStep({ store: st, gateway: gw({ posts: [rp("old", 24 * 60)], seen }), now: () => NOW }, igOnly, () => undefined);
    expect(st.posts.map((x) => x.p.externalId)).toContain("old");
    expect(Date.parse(seen[0]!.since!)).toBeLessThan(NOW.getTime() - 100 * 86400e3);
  });
  it("an incremental run stops paging when a whole page is older than the cut-off", async () => {
    const st = new Mem(); st.seedLast = h(24);
    let calls = 0;
    const g = gw({}); g.posts = async () => { calls++; return { items: [rp("x", 24 * 40)], after: "next" }; };
    await organicStep({ store: st, gateway: g, now: () => NOW }, igOnly, () => undefined);
    expect(calls).toBe(1);
  });
  it("only a story and a refused account metric: partial with the Graph code and no_posts_returned, never ok", async () => {
    const st = new Mem();
    const r = await organicStep({ store: st, gateway: gw({ stories: [rp("s1", 2, "story")] }), now: () => NOW }, igOnly, () => undefined);
    expect(st.status.at(-1)?.status).toBe("partial");
    expect(r.status).toBe("partial");
    expect(r.reason).toContain("follower_count:100");
    expect(st.status.at(-1)?.error).toContain("no_posts_returned");
  });
  it("no posts and clean account metrics: no_data, never ok", async () => {
    const st = new Mem();
    const r = await organicStep({ store: st, gateway: gw({ days: () => [goodDay] }), now: () => NOW }, igOnly, () => undefined);
    expect(st.status.at(-1)?.status).toBe("no_data");
    expect(r.status).toBe("no_data");
    expect(r.reason).toBe("no_posts_returned");
  });
  it("a refused account metric is rejected with its Graph code and the follower snapshot is still stored", async () => {
    const st = new Mem(), rejected: string[] = [];
    await organicStep({ store: st, gateway: gw({ posts: [rp("a", 5)] }), now: () => NOW }, igOnly, (r) => rejected.push(r));
    expect(rejected).toContain("account_follower_count_graph_100");
    expect(st.am.some((r) => r.followers === 572 && r.day === "2026-11-26")).toBe(true);
    expect(st.status.at(-1)?.status).toBe("partial");
  });
  it("a Page with 0 followers and 0 posts is no_data, not a measured zero", async () => {
    const st = new Mem();
    await organicStep({ store: st, gateway: gw({ followers: 0, days: () => [] }), now: () => NOW }, { ...C, igUserId: undefined }, () => undefined);
    expect(st.status.at(-1)?.status).toBe("no_data");
  });
  it("clean run with posts is ok", async () => {
    const st = new Mem();
    const r = await organicStep({ store: st, gateway: gw({ posts: [rp("a", 5)], days: () => [goodDay] }), now: () => NOW }, igOnly, () => undefined);
    expect(st.status.at(-1)?.status).toBe("ok");
    expect(r.status).toBeUndefined();
  });
});
