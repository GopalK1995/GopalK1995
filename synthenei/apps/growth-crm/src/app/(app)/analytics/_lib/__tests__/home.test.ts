import { describe, expect, it } from "vitest";
import type { Campaign, CampaignDay, Deal, Lead, Task } from "@/lib/data/types";
import { assembleView, type Raw } from "@/lib/connectors/meta/organic/view";
import { costPerConverted, decisions, leadFunnel, monthRuler, paidVsOrganic, stageFlow, teamVsTarget, tiles, topAccounts, type StageMap } from "../home";
import { attributionFromTouches, UNKNOWN_TOUCH } from "../touches";

const NOW = "2026-11-10T06:30:00.000Z";   // 10 Nov, 12:00 IST
const stages: StageMap = {
  new: { label: "New", order: 1, outcome: "open", slaHours: 24 }, quote: { label: "Quote", order: 2, outcome: "open" },
  won: { label: "Won", order: 3, outcome: "won" }, lost: { label: "Lost", order: 4, outcome: "lost" },
};
const deal = (o: Partial<Deal>): Deal => ({ id: "d", name: "D", accountId: "a1", leadId: "l1", ownerId: "r1", stage: "quote", value: 100000, seats: 1, plan: "Practice", probability: 0.5, createdAt: "2026-10-01T00:00:00Z", expectedClose: "2026-11-20", stageEnteredAt: "2026-11-09T00:00:00Z", ...o });
const lead = (o: Partial<Lead>): Lead => ({
  id: "l", name: "L", title: "", accountId: "a1", email: "", phone: "", city: "", stage: "new", ownerId: "r1", status: "new", channel: "meta", campaignId: null,
  utm: { source: "", medium: "", campaign: null }, firstTouch: "meta", lastTouch: "meta", createdAt: "2026-11-09T00:00:00Z", lastTouchAt: "2026-11-09T00:00:00Z", firstResponseMins: null,
  nextActionAt: null, nextAction: null, score: 0, scoreFactors: [], consent: { followup: true, marketing: false, whatsapp: false, at: "", noticeVersion: "" }, potentialValue: 0, tags: [], ...o,
});

describe("monthRuler", () => {
  const deals = [
    deal({ id: "w1", stage: "won", wonAt: "2026-11-03T06:00:00Z", value: 200000 }),
    deal({ id: "w0", stage: "won", wonAt: "2026-10-28T06:00:00Z", value: 900000 }),   // last month: not counted
    deal({ id: "o1", expectedClose: "2026-11-20", value: 100000, probability: 0.5 }),
    deal({ id: "o2", expectedClose: "2026-11-05", value: 50000 }),                      // slipped
  ];
  it("accumulates won value, paces the target and forecasts from weighted open deals", () => {
    const r = monthRuler(deals, stages, NOW, 600000);
    expect(r.today).toBe(10); expect(r.days).toBe(30);
    expect(r.won).toBe(200000); expect(r.gap).toBe(400000);
    expect(r.weightedRest).toBe(50000); expect(r.forecastEnd).toBe(250000);
    expect(r.slipped).toEqual({ count: 1, value: 50000 });
    expect(r.perDayNeeded).toBe(20000);
    expect(r.points[2].actual).toBe(200000);
    expect(r.points[10].actual).toBeNull();        // after today: a gap, not 0
    expect(r.points[5].forecast).toBeNull();       // before today: no forecast
    expect(r.points[19].forecast).toBe(250000);
    expect(r.points[29].pace).toBe(600000);
  });
  it("has no pace, gap or per-day need without a target", () => {
    const r = monthRuler(deals, stages, NOW, null);
    expect(r.target).toBeNull(); expect(r.gap).toBeNull(); expect(r.perDayNeeded).toBeNull(); expect(r.projectedPct).toBeNull();
    expect(r.points.every((p) => p.pace === null)).toBe(true);
  });
  it("reports a met target with a zero gap", () => {
    expect(monthRuler(deals, stages, NOW, 150000).gap).toBe(0);
  });
});

describe("stageFlow and decisions", () => {
  it("counts open value per stage in order and flags deals past the stage SLA", () => {
    const f = stageFlow([deal({ stage: "new", stageEnteredAt: "2026-11-07T00:00:00Z" }), deal({ stage: "new", stageEnteredAt: "2026-11-10T00:00:00Z" }), deal({ stage: "won" })], stages, NOW);
    expect(f.map((s) => s.key)).toEqual(["new", "quote"]);
    expect(f[0]).toMatchObject({ count: 2, value: 200000, stale: 1 });
  });
  it("lists only what needs acting on", () => {
    const none = decisions({ leads: [], deals: [], tasks: [], stages, now: NOW, slaHours: 2 });
    expect(none).toEqual([]);
    const task: Task = { id: "t", leadId: null, dealId: null, title: "x", kind: "call", ownerId: "r1", dueAt: "2026-11-08T00:00:00Z", status: "open", priority: "normal" };
    const d = decisions({ leads: [lead({ createdAt: "2026-11-09T00:00:00Z" })], deals: [deal({ expectedClose: "2026-11-12" }), deal({ id: "s", expectedClose: "2026-11-01" })], tasks: [task], stages, now: NOW, slaHours: 2 });
    expect(d.map((x) => x.id)).toEqual(["unanswered", "slipped", "closing", "overdue"]);
    expect(d.find((x) => x.id === "slipped")).toMatchObject({ count: 1, value: 100000 });
  });
});

describe("tiles", () => {
  const base = { stages, now: NOW, slaHours: 2, converted: () => false, rooms: null, days: [] as CampaignDay[] };
  it("returns null, not 0, when a reading cannot be computed", () => {
    const t = tiles(["cost", "conv", "winrate", "response", "repeat", "direct", "occupancy", "adr", "pipeline", "sla"], { ...base, leads: [], deals: [] });
    for (const x of t) expect(x.value, x.id).toBeNull();
  });
  it("computes won, new leads and cost from real rows, and ignores unknown tile ids", () => {
    const days: CampaignDay[] = [{ campaignId: "c1", date: "2026-11-05", spend: 20000, impressions: 1, reach: 1, clicks: 1, platformLeads: 1, engagements: 1 }];
    const leads = [lead({ id: "a", campaignId: "c1", stage: "won" }), lead({ id: "b", campaignId: "c1" })];
    const t = tiles(["won", "new", "cost", "nope"], { ...base, leads, deals: [deal({ stage: "won", wonAt: "2026-11-02T06:00:00Z", value: 70000 })], days, converted: (l) => l.stage === "won" });
    expect(t.map((x) => x.id)).toEqual(["won", "new", "cost"]);
    expect(t[0].value).toBe(70000); expect(t[1].value).toBe(2); expect(t[2].value).toBe(20000);
  });
});

describe("secondary breakdowns", () => {
  it("funnel steps come from the lead stages of the tenant config", () => {
    const ls: StageMap = { new: { label: "New", order: 1, outcome: "open" }, won: { label: "Won", order: 2, outcome: "won" }, lost: { label: "Lost", order: 3, outcome: "lost" } };
    const f = leadFunnel([lead({ stage: "new" }), lead({ stage: "won" }), lead({ stage: "lost" })], ls, "All");
    expect(f.map((s) => [s.label, s.n])).toEqual([["All", 3], ["New", 2], ["Won", 1]]);
  });
  it("cost per converted lead skips campaigns with no spend or no conversion", () => {
    const camps = [{ id: "c1", name: "A — x" }, { id: "c2", name: "B" }] as Campaign[];
    const days = [{ campaignId: "c1", spend: 1000 }] as CampaignDay[];
    const rows = costPerConverted(camps, days, [lead({ campaignId: "c1", stage: "won" }), lead({ campaignId: "c2", stage: "won" })], (l) => l.stage === "won");
    expect(rows).toEqual([{ label: "A", value: 1000, note: "1" }]);
  });
  it("top accounts and team", () => {
    expect(topAccounts([deal({ accountId: "a1" }), deal({ accountId: "a1" }), deal({ accountId: "a2", value: 1 })], stages, new Map([["a1", "Acme"]]))[0]).toMatchObject({ name: "Acme", value: 200000, deals: 2 });
    const team = [{ id: "r1", name: "R", role: "sales_rep", title: "", email: "", monthlyTarget: 0 }] as never;
    expect(teamVsTarget(team, [deal({ stage: "won", wonAt: "2026-11-02T06:00:00Z" })], stages, NOW)).toEqual([{ id: "r1", name: "R", won: 100000, target: null }]);
  });
});

describe("paidVsOrganic", () => {
  const camps = [{ id: "c1", channel: "meta" }, { id: "c2", channel: "google_ads" }] as Campaign[];
  const day = (o: Partial<CampaignDay>): CampaignDay => ({ campaignId: "c1", date: "2026-11-08", spend: 1000, impressions: 5000, reach: 3000, clicks: 100, platformLeads: 4, engagements: 250, ...o });
  const raw: Raw = {
    accounts: [{ id: "acc", platform: "instagram", display_name: "Brand", followers: 900 }], connections: [{ id: "i", status: "connected", scopes: [] }],
    posts: [{ id: "p1", account_id: "acc", kind: "reel", posted_at: "2026-11-05T06:00:00Z", status: "live" }, { id: "p2", account_id: "acc", kind: "feed", posted_at: "2026-11-06T06:00:00Z", status: "live" }],
    postMetrics: [{ post_id: "p1", day: "2026-11-09", impressions: 800, reach: 600, likes: 40, comments: 2, shares: null, saves: null, link_clicks: null }, { post_id: "p2", day: "2026-11-09" }],
    accountMetrics: [{ account_id: "acc", day: "2026-11-08", followers: 900, reach: 700 }],
  };
  const row = (p: ReturnType<typeof paidVsOrganic>, k: string) => p.rows.find((r) => r.key === k)!;
  it("puts paid and organic side by side, only paid-social campaigns, with nulls kept as null", () => {
    const p = paidVsOrganic({ campaigns: camps, days: [day({}), day({ campaignId: "c2", spend: 999999 })], leads: [lead({ campaignId: "c1" })], social: assembleView(raw), now: NOW });
    expect(row(p, "spend").paid).toBe(1000);
    expect(row(p, "reach")).toMatchObject({ paid: 3000, organic: 700 });
    expect(row(p, "engagements").organic).toBe(42);
    expect(row(p, "clicks").organic).toBeNull();                 // no post reported link clicks: unknown, not 0
    expect(row(p, "followers")).toMatchObject({ paid: "na", organic: 900 });
    expect(row(p, "costPerLead").paid).toBe(1000);
    expect(row(p, "spend").organic).toBe("na");
    expect(p.weekly.at(-1)).toMatchObject({ a: 3000, b: 700 });
    expect(p.weekly[0]).toMatchObject({ a: null, b: null });
  });
  it("shows no paid numbers when there are no campaign metrics, and no organic when it is not connected", () => {
    const p = paidVsOrganic({ campaigns: camps, days: [], leads: [], social: assembleView({ accounts: [], posts: [], postMetrics: [], accountMetrics: [], connections: [] }), now: NOW });
    expect(p.paidConnected).toBe(false); expect(p.organicState).toBe("not_connected");
    for (const r of p.rows) for (const v of [r.paid, r.organic]) expect(v === null || v === "na").toBe(true);
  });
});

describe("attributionFromTouches", () => {
  const opts = { unknownLabel: "No touch recorded", isDemo: () => false, isWon: (l: Lead) => l.stage === "won" };
  it("keeps a missing recorded touch as its own last row instead of crediting Organic", () => {
    const leads = [lead({ id: "1" }), lead({ id: "2" }), lead({ id: "3", stage: "won" })];
    const touches = new Map([["1", { first: "meta", last: "email" }], ["2", { first: null, last: null }]]);   // lead 3 has no row at all
    const first = attributionFromTouches(leads, "first", { ...opts, touches });
    expect(first.map((r) => [r.ch, r.leads])).toEqual([["meta", 1], [UNKNOWN_TOUCH, 2]]);
    expect(first[1]).toMatchObject({ label: "No touch recorded", won: 1 });
    expect(attributionFromTouches(leads, "last", { ...opts, touches })[0]).toMatchObject({ ch: "email", label: "Email" });
  });
  it("uses the lead's own touches when no override is given (demo)", () => {
    expect(attributionFromTouches([lead({ firstTouch: "linkedin" })], "first", opts)[0]).toMatchObject({ ch: "linkedin", leads: 1 });
  });
});
