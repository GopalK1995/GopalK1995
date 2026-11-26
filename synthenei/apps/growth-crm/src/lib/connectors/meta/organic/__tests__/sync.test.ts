// Sync rules against an in-memory store and a scripted gateway: dedupe on re-sync, nulls not zeros, refresh schedule, story window,
// rate-limit backoff (graph transport) and the stream's gates.
import { describe, expect, it } from "vitest";
import { CredentialError, TransientError } from "../../../core/types";
import { makeOrganicGraph } from "../graph";
import { organicStep } from "../sync";
import { socialRun, missingOrganicScopes } from "../stream";
import { EMPTY_METRICS, type AccountDay, type OrganicGateway, type PostMetrics, type RemotePost, type Scope, type SocialStore, type StoredPost } from "../types";

const NOW = new Date("2026-11-20T09:30:00Z");   // 15:00 IST
const h = (hours: number) => new Date(NOW.getTime() - hours * 3600e3).toISOString();
const C: Scope & { igUserId: string; pageId: string } = { tenantId: "t1", workspaceId: "w1", connectionId: "c1", igUserId: "ig1", pageId: "pg1" };
const M = (o: Partial<PostMetrics> = {}): PostMetrics => ({ ...EMPTY_METRICS, reach: 100, likes: 10, ...o });

class MemStore implements SocialStore {
  accounts = new Map<string, { id: string; platform: string; followers: number | null; status?: string }>();
  posts = new Map<string, { id: string; accountId: string; p: RemotePost; status: string }>();
  pm = new Map<string, { postId: string; day: string; metrics: PostMetrics; at: string }>();
  am = new Map<string, AccountDay & { accountId: string }>();
  async ensureAccount(i: Parameters<SocialStore["ensureAccount"]>[0]) {
    const k = `${i.workspaceId}|${i.platform}|${i.externalId}`;
    if (!this.accounts.has(k)) this.accounts.set(k, { id: `a${this.accounts.size + 1}`, platform: i.platform, followers: i.followers });
    const id = this.accounts.get(k)!.id;
    const last = [...this.posts.values()].filter((x) => x.accountId === id && x.p.kind !== "story").map((x) => x.p.postedAt).sort().at(-1) ?? null;
    return { id, lastPostAt: last };
  }
  async upsertPosts(i: Parameters<SocialStore["upsertPosts"]>[0]) { for (const p of i.posts) { const k = `${i.accountId}|${p.externalId}`; this.posts.set(k, { id: this.posts.get(k)?.id ?? `p${this.posts.size + 1}`, accountId: i.accountId, p, status: p.status }); } }
  async listPosts(accountId: string): Promise<StoredPost[]> {
    return [...this.posts.values()].filter((x) => x.accountId === accountId).map((x) => {
      const rows = [...this.pm.values()].filter((m) => m.postId === x.id);
      return { id: x.id, externalId: x.p.externalId, kind: x.p.kind, postedAt: x.p.postedAt, status: x.status as StoredPost["status"], lastMetricsAt: rows.map((r) => r.at).sort().at(-1) ?? null, hasMetrics: rows.some((r) => Object.values(r.metrics).some((v) => v !== null)) };
    });
  }
  async setPostStatus(id: string, status: StoredPost["status"]) { for (const v of this.posts.values()) if (v.id === id) v.status = status; }
  async upsertPostMetrics(rows: { postId: string; day: string; metrics: PostMetrics; at: string }[]) { for (const r of rows) this.pm.set(`${r.postId}|${r.day}`, r); }
  async upsertAccountMetrics(rows: (AccountDay & { accountId: string })[]) { for (const r of rows) this.am.set(`${r.accountId}|${r.day}`, r); }
  async markSynced(id: string, r: { status: string }) { for (const a of this.accounts.values()) if (a.id === id) a.status = r.status; }
}

interface Script { posts?: RemotePost[]; stories?: RemotePost[]; metrics?: (id: string) => PostMetrics | null | Error; days?: AccountDay[]; calls?: string[] }
const gw = (s: Script): OrganicGateway => ({
  kind: "fake",
  async profile(p) { return { externalId: p === "instagram" ? "ig1" : "pg1", displayName: "Acme", username: p === "instagram" ? "acme" : null, followers: 1000 }; },
  async posts(p) { return { items: p === "instagram" ? (s.posts ?? []) : [] }; },
  async stories(p) { return p === "instagram" ? (s.stories ?? []) : []; },
  async postMetrics(_p, post) { s.calls?.push(post.externalId); const r = s.metrics ? s.metrics(post.externalId) : M(); if (r instanceof Error) throw r; return r; },
  async accountDays() { return s.days ?? []; },
});
const rp = (id: string, hoursAgo: number, kind: RemotePost["kind"] = "feed"): RemotePost => ({ externalId: id, kind, caption: null, permalink: null, mediaUrl: null, postedAt: h(hoursAgo) });
const run = (store: MemStore, g: OrganicGateway, now = NOW) => organicStep({ store, gateway: g, now: () => now }, C, () => undefined);

describe("organic sync", () => {
  it("re-syncing never duplicates posts, post-days or account-days", async () => {
    const st = new MemStore(), s: Script = { posts: [rp("a", 30), rp("b", 60)], days: [{ day: "2026-11-19", followers: 1000, followerDelta: 2, profileViews: 5, reach: 50, websiteClicks: 1 }] };
    await run(st, gw(s)); await run(st, gw(s)); await run(st, gw(s));
    expect(st.posts.size).toBe(2);
    expect(st.pm.size).toBe(2);
    expect(st.am.size).toBe(4);   // per platform account: the reported day plus the follower snapshot of today
  });

  it("stores nulls, never zeros, when Meta has no insights for a post", async () => {
    const st = new MemStore();
    const r = await run(st, gw({ posts: [rp("a", 30), rp("b", 40)], metrics: (id) => (id === "a" ? null : M()) }));
    const rows = [...st.pm.values()];
    expect(rows).toHaveLength(2);
    const a = rows.find((x) => x.postId === "p1")!;
    expect(Object.values(a.metrics).every((v) => v === null)).toBe(true);
    expect(r.rowsRejected).toBe(1);
  });

  it("re-fetches posts under 30 days every run, older ones weekly", async () => {
    const st = new MemStore(), calls: string[] = [];
    const s: Script = { posts: [rp("young", 24 * 5), rp("old", 24 * 45)], calls };
    await run(st, gw(s));
    expect(calls.sort()).toEqual(["old", "young"]);
    calls.length = 0;
    await run(st, gw({ ...s, posts: [], calls }), new Date(NOW.getTime() + 3 * 3600e3));   // 3 hours later
    expect(calls).toEqual(["young"]);
    calls.length = 0;
    await run(st, gw({ ...s, posts: [], calls }), new Date(NOW.getTime() + 8 * 86400e3));  // 8 days later
    expect(calls).toContain("old");
  });

  it("captures a live story on every run and stops once it passes 24 h", async () => {
    const st = new MemStore(), calls: string[] = [];
    const story = rp("s1", 3, "story");
    await run(st, gw({ stories: [story], calls }));
    await run(st, gw({ stories: [story], calls }), new Date(NOW.getTime() + 3 * 3600e3));
    expect(calls).toEqual(["s1", "s1"]);
    calls.length = 0;
    await run(st, gw({ stories: [], calls }), new Date(NOW.getTime() + 22 * 3600e3));   // story now 25 h old and no longer listed
    expect(calls).toEqual([]);
    expect([...st.posts.values()][0]!.status).toBe("expired");
    expect([...st.pm.values()].some((m) => m.metrics.reach === 100)).toBe(true);   // what was captured while live is kept
  });

  it("a rate limit that outlasts the backoff ends the run partial, keeping what was stored", async () => {
    const st = new MemStore();
    let n = 0;
    const r = await run(st, gw({ posts: [rp("a", 30), rp("b", 40), rp("c", 50)], metrics: () => (++n > 1 ? new TransientError("busy") : M()) }));
    expect(st.pm.size).toBe(1);
    expect((r.sample as { pending: boolean }).pending).toBe(true);
    expect(r.done).toBe(true);
  });

  it("a dead token throws CredentialError (needs_attention) and marks the account", async () => {
    const st = new MemStore();
    await expect(run(st, gw({ posts: [rp("a", 30)], metrics: () => new CredentialError("dead") }))).rejects.toBeInstanceOf(CredentialError);
    expect([...st.accounts.values()].some((a) => a.status === "needs_attention")).toBe(true);
  });

  it("skips when no page or Instagram account is selected", async () => {
    const r = await organicStep({ store: new MemStore(), gateway: gw({}), now: () => NOW }, { ...C, igUserId: undefined, pageId: undefined }, () => undefined);
    expect(r.sample).toEqual({ skipped: "no_accounts" });
  });
});

describe("graph transport", () => {
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
  const opts = (fetchImpl: typeof fetch, sleeps: number[]) => ({ apiBase: "https://graph.test", version: "v99.0", pageToken: "tok", pageId: "pg1", igUserId: "ig1", appSecret: "sec", fetch: fetchImpl, sleep: async (ms: number) => { sleeps.push(ms); }, random: () => 0, policy: { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 } });

  it("retries Meta's HTTP 400 rate-limit code with backoff, honours Retry-After, signs with appsecret_proof, uses the configured base and version", async () => {
    const urls: string[] = [], sleeps: number[] = [];
    const responses = [json(400, { error: { code: 17 } }), json(429, {}, { "retry-after": "2" }), json(200, { data: [{ name: "reach", values: [{ value: 5 }] }] })];
    const g = makeOrganicGraph(opts((async (u: string) => { urls.push(u); return responses.shift()!; }) as unknown as typeof fetch, sleeps));
    const m = await g.postMetrics("instagram", { externalId: "m1", kind: "feed" });
    expect(m?.reach).toBe(5);
    expect(sleeps).toEqual([50, 2000]);
    expect(urls[0]).toMatch(/^https:\/\/graph\.test\/v99\.0\/m1\/insights\?/);
    expect(urls[0]).toContain("appsecret_proof=");
  });
  it("gives up with TransientError after the retry budget", async () => {
    const g = makeOrganicGraph(opts((async () => json(500, {})) as unknown as typeof fetch, []));
    await expect(g.postMetrics("instagram", { externalId: "m1", kind: "feed" })).rejects.toBeInstanceOf(TransientError);
  });
  it("metrics Meta refuses for one post (code 100) are no data, not a failure; a dead token is a CredentialError", async () => {
    const g1 = makeOrganicGraph(opts((async () => json(400, { error: { code: 100, error_subcode: 33 } })) as unknown as typeof fetch, []));
    expect(await g1.postMetrics("instagram", { externalId: "m1", kind: "feed" })).toBeNull();
    const g2 = makeOrganicGraph(opts((async () => json(401, { error: { code: 190 } })) as unknown as typeof fetch, []));
    await expect(g2.postMetrics("instagram", { externalId: "m1", kind: "feed" })).rejects.toBeInstanceOf(CredentialError);
  });
});

describe("stream gates", () => {
  const ctx = (secrets: Record<string, string>) => ({ conn: { id: "c1", tenantId: "t1", workspaceId: "w1" }, secrets: async () => secrets, reject: () => undefined }) as never;
  const rt = (env: Record<string, string>, extra: object = {}) => ({ env, store: new MemStore(), now: () => NOW, ...extra });

  it("the sandbox token never writes rows", async () => {
    const r = await socialRun(ctx({ access_token: "meta-mock-token", page_id: "pg1" }), rt({}));
    expect(r.sample).toEqual({ skipped: "sandbox" });
  });
  it("lists the permissions the organic reads need", () => {
    expect(missingOrganicScopes(["instagram_basic", "pages_show_list"])).toEqual(["instagram_manage_insights", "pages_read_engagement", "read_insights"]);
    expect(missingOrganicScopes([])).toEqual([]);   // unknown scopes are not alarming
  });
  it("missing insights permissions end the run as needs_vendor_approval without calling the insights API", async () => {
    const urls: string[] = [];
    const f = (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ data: { is_valid: true, scopes: ["instagram_basic"], expires_at: 0 } }), { status: 200 }); }) as unknown as typeof fetch;
    const r = await socialRun(ctx({ access_token: "real", page_token: "pt", page_id: "pg1", ig_user_id: "ig1" }), rt({ META_APP_ID: "1", META_APP_SECRET: "s", META_GRAPH_API_BASE: "https://graph.test", META_GRAPH_API_VERSION: "v99.0" }, { fetchImpl: f }));
    expect((r.sample as { skipped: string }).skipped).toBe("needs_vendor_approval");
    expect(urls.every((u) => u.includes("debug_token"))).toBe(true);
  });
});
