import { describe, expect, it } from "vitest";
import { demoView } from "../demo";
import { assembleView, type Raw } from "../view";

const raw = (o: Partial<Raw> = {}): Raw => ({ accounts: [], posts: [], postMetrics: [], accountMetrics: [], connections: [{ id: "c1", status: "connected", scopes: [] }], ...o });
const acct = { id: "a1", platform: "instagram", external_id: "ig1", display_name: "Acme", username: "acme", followers: 10, last_synced_at: "2026-11-20T09:00:00Z", last_sync_status: "ok", last_error: null };
const post = (id: string, at = "2026-11-10T00:00:00Z") => ({ id, account_id: "a1", kind: "reel", caption: id, permalink: null, posted_at: at, status: "live" });

describe("assembleView states", () => {
  it("not connected without a connection or accounts", () => { expect(assembleView(raw({ connections: [] })).state).toBe("not_connected"); });
  it("empty when connected but nothing synced", () => { expect(assembleView(raw()).state).toBe("empty"); });
  it("needs attention when the connection or an account says so", () => {
    expect(assembleView(raw({ connections: [{ id: "c1", status: "needs_attention", scopes: [] }] })).state).toBe("needs_attention");
    expect(assembleView(raw({ accounts: [{ ...acct, last_sync_status: "needs_attention" }] })).state).toBe("needs_attention");
  });
  it("needs vendor approval when the last run skipped for permissions, or the granted scopes lack insights", () => {
    expect(assembleView(raw({ lastSkip: { skipped: "needs_vendor_approval", missing: ["read_insights"] } })).missingScopes).toEqual(["read_insights"]);
    expect(assembleView(raw({ connections: [{ id: "c1", status: "connected", scopes: ["instagram_basic"] }] })).state).toBe("needs_vendor_approval");
  });
  it("ready with data", () => { expect(assembleView(raw({ accounts: [acct], posts: [post("p1")] })).state).toBe("ready"); });
});

describe("assembleView numbers", () => {
  it("keeps unknown metrics null, takes the newest snapshot, and counts partial sync", () => {
    const v = assembleView(raw({
      accounts: [acct], posts: [post("p1"), post("p2", "2026-11-11T00:00:00Z")],
      postMetrics: [
        { post_id: "p1", day: "2026-11-18", reach: 100, likes: 5, comments: null, impressions: null, engagement_rate: "0.05" },
        { post_id: "p1", day: "2026-11-19", reach: 150, likes: 9, comments: null, impressions: null, engagement_rate: "0.06" },
        { post_id: "p2", day: "2026-11-19", reach: null, likes: null, comments: null, impressions: null, engagement_rate: null },
      ],
    }));
    const p1 = v.posts.find((p) => p.id === "p1")!, p2 = v.posts.find((p) => p.id === "p2")!;
    expect(p1.metrics.reach).toBe(150);
    expect(p1.metrics.comments).toBeNull();
    expect(p1.series).toHaveLength(2);
    expect(p2.metrics.reach).toBeNull();
    expect(p2.engagement).toBeNull();
    expect(v.synced).toEqual({ done: 1, total: 2 });
  });
  it("trend sums accounts per day and leaves a day null when no account reported it", () => {
    const v = assembleView(raw({ accounts: [acct], accountMetrics: [{ account_id: "a1", day: "2026-11-19", followers: 10, reach: null }, { account_id: "a2", day: "2026-11-19", followers: 5, reach: null }] }));
    expect(v.trend).toEqual([{ day: "2026-11-19", followers: 15, reach: null }]);
  });
  it("ignores posts of an account the viewer cannot see", () => { expect(assembleView(raw({ accounts: [acct], posts: [{ ...post("x"), account_id: "other" }] })).posts).toHaveLength(0); });
});

describe("demo", () => {
  it("is labelled demo, deterministic, and contains unreported metrics as null", () => {
    const a = demoView(new Date("2026-11-20T00:00:00Z")), b = demoView(new Date("2026-11-20T00:00:00Z"));
    expect(a.demo).toBe(true);
    expect(a.state).toBe("ready");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.posts.some((p) => p.metrics.reach === null)).toBe(true);
  });
});

describe("several accounts (AUD-100)", () => {
  const a2 = { ...acct, id: "a2", platform: "facebook", external_id: "pg2", display_name: "Studio Two", username: null, followers: 30 };
  const m = (account_id: string, day: string, followers: number, reach: number) => ({ account_id, day, followers, reach });
  it("sums the trend over every account and keeps each account's own series for the filter", () => {
    const v = assembleView(raw({ accounts: [acct, a2], accountMetrics: [m("a1", "2026-11-19", 10, 5), m("a2", "2026-11-19", 30, 7), m("a2", "2026-11-20", 31, 8)] }));
    expect(v.trend).toEqual([{ day: "2026-11-19", followers: 40, reach: 12 }, { day: "2026-11-20", followers: 31, reach: 8 }]);
    expect(v.trendByAccount.a1).toEqual([{ day: "2026-11-19", followers: 10, reach: 5 }]);
    expect(v.trendByAccount.a2).toHaveLength(2);
  });
  it("an account removed from the workspace (integration_id null) is neither listed nor summed, and history stays in the database", () => {
    const gone = { ...a2, integration_id: null };
    const v = assembleView(raw({ accounts: [{ ...acct, integration_id: "c1" }, gone], posts: [post("p1"), { ...post("p2"), account_id: "a2" }], accountMetrics: [m("a1", "2026-11-19", 10, 5), m("a2", "2026-11-19", 30, 7)] }));
    expect(v.accounts.map((a) => a.id)).toEqual(["a1"]);
    expect(v.posts.map((p) => p.id)).toEqual(["p1"]);
    expect(v.trend).toEqual([{ day: "2026-11-19", followers: 10, reach: 5 }]);
    expect(assembleView(raw({ connections: [], accounts: [gone] })).state).toBe("not_connected");
  });
  it("one account failing shows on that account while the other stays ok", () => {
    const v = assembleView(raw({ accounts: [acct, { ...a2, last_sync_status: "needs_attention", last_error: "Meta rejected the saved credentials" }] }));
    expect(v.accounts.map((a) => a.status)).toEqual(["ok", "needs_attention"]);
    expect(v.state).toBe("needs_attention");
  });
});
