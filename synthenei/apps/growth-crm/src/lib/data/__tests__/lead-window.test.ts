import { describe, expect, it } from "vitest";
import { leadsInWindow, newLeadsInWindow, windowBounds, windowLabel } from "../lead-window";

const L = (createdAt: string, campaignId: string | null = null) => ({ createdAt, campaignId });
// 26 Nov 2026 12:30 UTC = 18:00 IST
const NOW = "2026-11-26T12:30:00Z";

describe("lead window (IST calendar days, today included)", () => {
  it("starts at IST midnight N-1 days ago and ends at tomorrow's IST midnight", () => {
    const { startMs, endMs } = windowBounds(NOW, 30);
    expect(new Date(startMs).toISOString()).toBe("2026-10-27T18:30:00.000Z"); // = 28 Oct 00:00 IST
    expect(new Date(endMs).toISOString()).toBe("2026-11-26T18:30:00.000Z"); // 27 Nov 00:00 IST
  });
  it("respects the IST day boundary, not a rolling 24h clock", () => {
    // 00:10 IST on 28 Oct is inside, 23:50 IST on 27 Oct is outside
    const inside = L("2026-10-27T18:40:00Z"), outside = L("2026-10-27T18:20:00Z");
    expect(newLeadsInWindow([inside, outside], NOW, { days: 30 })).toBe(1);
  });
  it("campaign scope counts only attributed leads, all scope counts everyone", () => {
    const ls = [L("2026-11-20T05:00:00Z", "c1"), L("2026-11-21T05:00:00Z"), L("2026-11-22T05:00:00Z", "c2")];
    expect(newLeadsInWindow(ls, NOW, { days: 90 })).toBe(3);
    expect(newLeadsInWindow(ls, NOW, { days: 90, scope: "campaign" })).toBe(2);
  });
  it("is not all-time: old campaign leads fall outside 90 days (the 96 vs 63 bug)", () => {
    const ls = [L("2026-07-17T05:00:00Z", "c1"), L("2026-10-12T05:00:00Z", "c1")];
    expect(newLeadsInWindow(ls, NOW, { days: 90, scope: "campaign" })).toBe(1);
  });
  it("prior period is adjacent and non-overlapping", () => {
    const cur = leadsInWindow([L("2026-11-01T05:00:00Z"), L("2026-09-30T05:00:00Z")], NOW, { days: 30 });
    const prev = leadsInWindow([L("2026-11-01T05:00:00Z"), L("2026-09-30T05:00:00Z")], NOW, { days: 30, offsetDays: 30 });
    expect(cur.length).toBe(1); expect(prev.length).toBe(1);
  });
  it("labels state window, timezone and scope", () => {
    expect(windowLabel(90)).toBe("Last 90 days (IST) · all leads");
    expect(windowLabel(30, "campaign")).toContain("campaign-attributed");
  });
});
