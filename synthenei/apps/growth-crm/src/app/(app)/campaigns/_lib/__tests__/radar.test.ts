import { describe, expect, it } from "vitest";
import { avgScores, meanScore, radarScores } from "../marketing";
import { toDayRow, toDbDay } from "@/lib/segments/repo";
import type { CampaignStats } from "@/lib/data/metrics";

const st = (o: Partial<CampaignStats>) => ({ id: "a", reach: 100, engagementRate: 0.1, ctr: 0.02, leadRate: 0.05, spend: 1000, leads: 10, cpl: 100, ...o }) as CampaignStats;

describe("radarScores", () => {
  it("a missing cost reading is null, not 0", () => {
    const m = radarScores([st({ id: "a" }), st({ id: "b", cpl: NaN, spend: 500, leads: 0 })]);
    expect(m.get("b")![4]).toBeNull();
    expect(m.get("a")![4]).toBe(100);
  });
  it("NaN engagement is null and does not drag peers", () => {
    const m = radarScores([st({ id: "a" }), st({ id: "b", engagementRate: NaN })]);
    expect(m.get("b")![1]).toBeNull(); expect(m.get("a")![1]).toBe(100);
  });
  it("real zeros stay 0 and no-spend email with leads is best", () => {
    const m = radarScores([st({ id: "a", ctr: 0 }), st({ id: "b", spend: 0, leads: 3, cpl: NaN })]);
    expect(m.get("a")![2]).toBe(0); expect(m.get("b")![4]).toBe(100);
  });
  it("mean and average skip nulls", () => {
    expect(meanScore([null, null])).toBe(-1); expect(meanScore([50, null, 100])).toBe(75);
    expect(avgScores([[10, null, null, null, null], [30, null, null, null, null]])).toEqual([20, null, null, null, null]);
  });
});

describe("campaign_daily_metrics mapping (upstream NaN cause)", () => {
  it("spend_inr column maps to spend", () => {
    expect(toDayRow({ campaign_id: "c", day: "2026-10-01", spend_inr: "1234.50", clicks: 3 }).spend).toBe(1234.5);
    expect(Number.isNaN(toDayRow({ campaign_id: "c", day: "d" }).spend)).toBe(false);
  });
  it("writes spend as spend_inr", () => {
    const r = toDbDay({ campaignId: "c", day: "d", spend: 9, impressions: 0, reach: 0, clicks: 0, reactions: 0, comments: 0, shares: 0, opens: 0, bounces: 0, unsubscribes: 0, platformLeads: 0 });
    expect(r.spend_inr).toBe(9); expect("spend" in r).toBe(false); expect(r.platform_leads).toBe(0);
  });
});
