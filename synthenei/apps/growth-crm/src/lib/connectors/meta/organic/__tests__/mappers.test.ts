// Fixture-tested mappers for the Graph insights responses: units, nulls, story expiry, engagement-rate math.
import { describe, expect, it } from "vitest";
import {
  count, engagementRate, igKind, mapAccountInsights, mapFbPost, mapFbPostInsights, mapIgMedia, mapIgPostInsights, postStatus, shouldRefreshMetrics, storyStatus,
} from "../mappers";
import type { StoredPost } from "../types";

const entry = (name: string, value: unknown) => ({ name, period: "lifetime", values: [{ value }] });
const NOW = new Date("2026-11-20T12:00:00Z");
const h = (hours: number) => new Date(NOW.getTime() - hours * 3600e3).toISOString();
const post = (o: Partial<StoredPost>): StoredPost => ({ id: "p", externalId: "x", kind: "feed", postedAt: h(24 * 3), status: "live", lastMetricsAt: null, hasMetrics: false, ...o });

describe("count", () => {
  it("accepts finite non-negative numbers and numeric strings, floors, and rejects everything else as null (never 0)", () => {
    expect(count(12)).toBe(12);
    expect(count("1,234")).toBe(1234);
    expect(count(3.9)).toBe(3);
    expect(count(0)).toBe(0);
    for (const bad of [undefined, null, "", "abc", -1, NaN, Infinity, { a: 1 }, [1]]) expect(count(bad)).toBeNull();
  });
});

describe("mapIgPostInsights", () => {
  it("maps a feed post: views is the impression count, saved is saves", () => {
    const m = mapIgPostInsights({ data: [entry("reach", 400), entry("views", 520), entry("likes", 30), entry("comments", 6), entry("shares", 4), entry("saved", 10)] }, "feed");
    expect(m).toEqual({ impressions: 520, reach: 400, likes: 30, comments: 6, shares: 4, saves: 10, videoViews: null, linkClicks: null });
  });
  it("a reel's views are video views, not impressions", () => {
    const m = mapIgPostInsights({ data: [entry("reach", 900), entry("views", 1500)] }, "reel");
    expect(m.videoViews).toBe(1500);
    expect(m.impressions).toBeNull();
  });
  it("legacy names (impressions, plays) still map; an explicit impressions value wins over views", () => {
    const m = mapIgPostInsights({ data: [entry("impressions", 700), entry("views", 9), entry("plays", 55)] }, "video");
    expect(m.impressions).toBe(700);
    expect(m.videoViews).toBe(55);
  });
  it("missing, null, negative and breakdown values stay null instead of becoming 0", () => {
    const m = mapIgPostInsights({ data: [entry("reach", null), entry("likes", -4), { name: "comments", total_value: { value: { a: 1 } } }, entry("shares", undefined)] }, "feed");
    expect(Object.values(m).every((v) => v === null)).toBe(true);
  });
  it("reads total_value aggregates and tolerates garbage input", () => {
    expect(mapIgPostInsights({ data: [{ name: "reach", total_value: { value: 77 } }] }, "feed").reach).toBe(77);
    expect(mapIgPostInsights(null, "feed").reach).toBeNull();
    expect(mapIgPostInsights({ data: "nope" }, "feed").reach).toBeNull();
  });
});

describe("Facebook mappers", () => {
  it("post fields: reaction/comment summaries and shares; absent shares is unknown, not 0", () => {
    const p = mapFbPost({ id: "1_2", created_time: "2026-11-18T10:00:00+0000", message: "hi", permalink_url: "https://fb.example/p", reactions: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, attachments: { data: [{ media_type: "video" }] } });
    expect(p).toMatchObject({ externalId: "1_2", kind: "video", postedAt: "2026-11-18T10:00:00.000Z", inline: { likes: 12, comments: 3, shares: null } });
  });
  it("insights merge with the inline counts; no commenter data is read", () => {
    const m = mapFbPostInsights({ data: [entry("post_impressions", 900), entry("post_impressions_unique", 700)] }, { likes: 12, comments: 3, shares: 2 });
    expect(m).toMatchObject({ impressions: 900, reach: 700, likes: 12, comments: 3, shares: 2, saves: null });
  });
  it("rejects a post without id or time", () => {
    expect(mapFbPost({ id: "x" })).toBeNull();
    expect(mapFbPost("x")).toBeNull();
  });
});

describe("media mapping", () => {
  it("kinds: story endpoint, reels product type, carousel, video, feed", () => {
    expect(igKind("IMAGE", "FEED", true)).toBe("story");
    expect(igKind("VIDEO", "REELS")).toBe("reel");
    expect(igKind("CAROUSEL_ALBUM", "FEED")).toBe("carousel");
    expect(igKind("VIDEO", "FEED")).toBe("video");
    expect(igKind("IMAGE", "FEED")).toBe("feed");
  });
  it("parses Graph's +0000 timestamps and drops rows without id or time", () => {
    expect(mapIgMedia({ id: "9", timestamp: "2026-11-19T08:30:00+0000", media_type: "IMAGE", caption: "c", media_url: "m" })?.postedAt).toBe("2026-11-19T08:30:00.000Z");
    expect(mapIgMedia({ id: "9" })).toBeNull();
  });
});

describe("mapAccountInsights", () => {
  it("assigns each value to the day BEFORE its end_time and keeps unknowns null", () => {
    const days = mapAccountInsights({ data: [
      { name: "reach", values: [{ value: 100, end_time: "2026-11-19T08:00:00+0000" }, { value: 120, end_time: "2026-11-20T08:00:00+0000" }] },
      { name: "follower_count", values: [{ value: -2, end_time: "2026-11-19T08:00:00+0000" }] },
    ] }, 5000);
    expect(days).toEqual([
      { day: "2026-11-18", followers: null, followerDelta: -2, profileViews: null, reach: 100, websiteClicks: null },
      { day: "2026-11-19", followers: 5000, followerDelta: null, profileViews: null, reach: 120, websiteClicks: null },
    ]);
  });
});

describe("engagementRate", () => {
  it("interactions / reach, rounded to four places (same as the SQL column)", () => {
    expect(engagementRate({ reach: 400, likes: 30, comments: 6, shares: 4, saves: 10 })).toBe(0.125);
    expect(engagementRate({ reach: 3, likes: 1, comments: null, shares: null, saves: null })).toBe(0.3333);
  });
  it("is null, not 0, when reach is unknown or zero or no interaction count exists", () => {
    expect(engagementRate({ reach: null, likes: 5, comments: 1, shares: 0, saves: 0 })).toBeNull();
    expect(engagementRate({ reach: 0, likes: 5, comments: 1, shares: 0, saves: 0 })).toBeNull();
    expect(engagementRate({ reach: 50, likes: null, comments: null, shares: null, saves: null })).toBeNull();
  });
});

describe("story window", () => {
  it("live for 24 h, expired after; non-stories are always live", () => {
    expect(storyStatus(h(23), NOW)).toBe("live");
    expect(storyStatus(h(25), NOW)).toBe("expired");
    expect(postStatus({ kind: "story", postedAt: h(30) }, NOW)).toBe("expired");
    expect(postStatus({ kind: "reel", postedAt: h(300) }, NOW)).toBe("live");
  });
});

describe("shouldRefreshMetrics", () => {
  it("every run for posts younger than 30 days", () => {
    expect(shouldRefreshMetrics(post({ postedAt: h(24 * 29), lastMetricsAt: h(1) }), NOW)).toBe(true);
    expect(shouldRefreshMetrics(post({ lastMetricsAt: null }), NOW)).toBe(true);
  });
  it("weekly after 30 days", () => {
    expect(shouldRefreshMetrics(post({ postedAt: h(24 * 45), lastMetricsAt: h(24 * 2) }), NOW)).toBe(false);
    expect(shouldRefreshMetrics(post({ postedAt: h(24 * 45), lastMetricsAt: h(24 * 8) }), NOW)).toBe(true);
  });
  it("stories only while live; deleted posts never", () => {
    expect(shouldRefreshMetrics(post({ kind: "story", postedAt: h(5), lastMetricsAt: h(3) }), NOW)).toBe(true);
    expect(shouldRefreshMetrics(post({ kind: "story", postedAt: h(26), status: "expired" }), NOW)).toBe(false);
    expect(shouldRefreshMetrics(post({ status: "deleted" }), NOW)).toBe(false);
  });
});
