import { describe, expect, it } from "vitest";
import { compileRules, normalizeRules, parseStoredRules } from "../compile";
import { consentedIds, purposeFor, summarize, type CanContact } from "../consent";
import { countSegment, segmentLeadIds } from "../query";
import { costPer, roi, roas, sumSpend, budgetUsed } from "../roi";
import { previewMetricsCsv, parseCsv } from "../metrics-csv";
import { createCampaign, addNote, editCampaign, importMetrics, toCsv, utmFor, type Ctx, type Repos } from "../persist";
import { createCampaignSchema, metricsRowSchema } from "../schemas";
import { DbError } from "@/lib/db/errors";
import { updateVersioned } from "@/lib/db/concurrency";
import { mockDb, ok, err, has } from "@/lib/db/__tests__/mock";
import type { CampaignRow } from "@/lib/db/repo/types";

describe("segment compiler", () => {
  it("compiles AND across rules and OR within a rule", () => {
    const r = compileRules([{ field: "district", op: "in", values: ["Madurai", "Trichy"] }, { field: "practice", values: ["Family"] }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.filters.map((f) => [f.column, f.values])).toEqual([["district", ["Madurai", "Trichy"]], ["practice_area", ["Family"]]]);
      expect(normalizeRules(r.filters)).toEqual([{ field: "district", op: "in", values: ["Madurai", "Trichy"] }, { field: "practice", op: "in", values: ["Family"] }]);
    }
  });
  it("drops empty rules and dedupes values", () => {
    const r = compileRules([{ field: "district", values: [] }, { field: "city", values: ["A", "A", "B"] }]);
    expect(r.ok && r.ignored).toBe(1);
    expect(r.ok && r.filters[0].values).toEqual(["A", "B"]);
  });
  it.each([
    ["sql in field name", [{ field: "district; drop table leads", values: ["x"] }]],
    ["column not on the allow-list", [{ field: "email", values: ["a@b.c"] }]],
    ["raw column name", [{ field: "deleted_at", values: ["x"] }]],
    ["jsonb path as system field", [{ field: "custom->>secret", values: ["x"] }]],
    ["unknown custom key", [{ field: "budget_band", values: ["x"] }]],
    ["quote in value", [{ field: "district", values: ['x"),or(id.neq.0'] }]],
    ["backslash in value", [{ field: "district", values: ["a\\b"] }]],
    ["newline in value", [{ field: "district", values: ["a\nb"] }]],
    ["comma-paren injection via operator", [{ field: "district", op: "or", values: ["x"] }]],
    ["non-string value", [{ field: "district", values: [{ $ne: 1 }] }]],
    ["too long value", [{ field: "district", values: ["x".repeat(500)] }]],
    ["same field twice", [{ field: "district", values: ["a"] }, { field: "district", values: ["b"] }]],
    ["not a list", { field: "district" }],
    ["bool field with text", [{ field: "personalEmail", values: ["yes"] }]],
  ])("rejects %s", (_n, input) => {
    expect(compileRules(input).ok).toBe(false);
  });
  it("accepts only filterable custom fields the caller lists, and builds a jsonb text path", () => {
    expect(compileRules([{ field: "budget_band", values: ["high"] }], [{ key: "budget_band" }]).ok).toBe(true);
    const r = compileRules([{ field: "budget_band", values: ["high"] }], [{ key: "budget_band" }]);
    expect(r.ok && r.filters[0].column).toBe("custom->>budget_band");
    expect(compileRules([{ field: "Bad-Key", values: ["x"] }], [{ key: "Bad-Key" }]).ok).toBe(false);
  });
  it("round-trips stored rules and tolerates junk", () => {
    expect(parseStoredRules([{ field: "district", values: ["A", 3] }, null, { field: 1 }])).toEqual([{ field: "district", op: "in", values: ["A"] }]);
    expect(parseStoredRules("nope")).toEqual([]);
  });
});

describe("live evaluation over the request client (RLS decides visibility)", () => {
  const f = (compileRules([{ field: "district", values: ["Madurai", "Trichy"] }]) as { ok: true; filters: never[] }).filters;
  it("counts with bound IN filters, scoped to the workspace, hiding deleted rows", async () => {
    const { db, calls } = mockDb([{ data: null, error: null, count: 42 } as never]);
    expect(await countSegment(db, "ws-1", f)).toBe(42);
    const c = calls[0];
    expect(c.table).toBe("leads");
    expect(has(c, "eq", "workspace_id", "ws-1")).toBe(true);
    expect(has(c, "is", "deleted_at", null)).toBe(true);
    expect(has(c, "in", "district", ["Madurai", "Trichy"])).toBe(true);
  });
  it("RLS-empty result is a zero count, an error propagates", async () => {
    expect(await countSegment(mockDb([{ data: null, error: null, count: 0 } as never]).db, "ws", f)).toBe(0);
    await expect(countSegment(mockDb([err("42501")]).db, "ws", f)).rejects.toMatchObject({ code: "denied" });
  });
  it("caps the id list and reports truncation", async () => {
    const { db } = mockDb([ok([{ id: "a" }, { id: "b" }, { id: "c" }])]);
    expect(await segmentLeadIds(db, "ws", f, 2)).toEqual({ ids: ["a", "b"], truncated: true });
  });
});

describe("consent gate", () => {
  const can: CanContact = async (id) => id.startsWith("y");
  it("keeps only contacts passing can_contact, in order", async () => {
    expect(await consentedIds(["y1", "n1", "y2", "n2", "y3"], "marketing_email", can, 2)).toEqual(["y1", "y2", "y3"]);
  });
  it("a failed check is never counted as consent", async () => {
    await expect(consentedIds(["y1"], "whatsapp", async () => { throw new DbError("denied"); })).rejects.toBeInstanceOf(DbError);
  });
  it("passes the purpose per channel", async () => {
    const seen: string[] = [];
    await consentedIds(["y1"], purposeFor("whatsapp"), async (_i, p) => { seen.push(p); return true; });
    await consentedIds(["y1"], purposeFor("meta"), async (_i, p) => { seen.push(p); return true; });
    expect(seen).toEqual(["whatsapp", "marketing_email"]);
  });
  it("reports consented separately from total and flags a partial check", () => {
    expect(summarize(5000, ["a", "b"], true, ["a"], "marketing_email")).toEqual({ total: 5000, consented: 1, checked: 2, partial: true, purpose: "marketing_email" });
  });
});

describe("cost maths in INR", () => {
  it("CPL, no float drift, zero guards", () => {
    expect(sumSpend([{ spend: 0.1 }, { spend: 0.2 }])).toBe(0.3);
    expect(costPer(1000, 3)).toBe(333.33);
    expect(costPer(1000, 0)).toBeNull();
    expect(costPer(Number.NaN, 2)).toBeNull();
  });
  it("ROI and ROAS", () => {
    expect(roi(150000, 100000)).toBe(0.5);
    expect(roi(50000, 100000)).toBe(-0.5);
    expect(roi(1, 0)).toBeNull();
    expect(roas(250000, 100000)).toBe(2.5);
    expect(budgetUsed(25000, 100000)).toBe(0.25);
    expect(budgetUsed(1, null)).toBeNull();
  });
});

describe("metrics CSV preview", () => {
  const camps = [{ id: "c1", name: "LinkedIn Madurai", utmCampaign: "li_madurai_x_202610" }, { id: "c2", name: "Meta", utmCampaign: "meta_all_y_202610" }];
  const csv = ["date,utm_campaign,spend,impressions,clicks,leads",
    "2026-10-01,li_madurai_x_202610,\"1,250.50\",1000,40,3",
    "2026-10-01,Meta,500,2000,10,1",
    "2026-10-01,li_madurai_x_202610,10,1,0,0",
    "2026-10-02,nope,10,1,0,0",
    "31/02/2026,Meta,1,1,1,1",
    "2027-01-01,Meta,1,1,1,1",
    "2026-10-03,Meta,-5,1,1,1",
    "2026-10-04,Meta,abc,1,1,1"].join("\r\n");
  it("maps, accepts valid rows and says why each other row was rejected", () => {
    const p = previewMetricsCsv(csv, camps, "2026-10-31");
    expect(p.accepted.map((r) => [r.campaignId, r.day, r.spend, r.platformLeads])).toEqual([["c1", "2026-10-01", 1250.5, 3], ["c2", "2026-10-01", 500, 1]]);
    expect(p.rejected.map((r) => r.reason)).toEqual(["duplicate_day", "unknown_campaign", "bad_date", "future_date", "negative", "bad_number"]);
    expect(p.totalSpend).toBe(1750.5);
    expect(p.mapping.find((m) => m.column === "leads")?.field).toBe("platform_leads");
  });
  it("reports missing required columns and honours a fixed campaign", () => {
    expect(previewMetricsCsv("a,b\n1,2", camps, "2026-10-31").missingRequired).toEqual(["date", "campaign", "spend"]);
    const p = previewMetricsCsv("date,spend\n2026-10-01,5", camps, "2026-10-31", "c2");
    expect(p.accepted[0].campaignId).toBe("c2");
  });
  it("parses quoted commas, quotes and BOM", () => {
    expect(parseCsv('﻿a,b\n"x,1","he said ""hi"""\n')).toEqual([["a", "b"], ["x,1", 'he said "hi"']]);
  });
});

describe("schemas", () => {
  it("campaign: positive budget, name length, date order", () => {
    expect(createCampaignSchema.safeParse({ name: "abc", channel: "meta", budget: 1000 }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ name: "Valid name", channel: "meta", budget: 0 }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ name: "Valid name", channel: "tiktok", budget: 10 }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ name: "Valid name", channel: "meta", budget: 10, startsOn: "2026-10-05", endsOn: "2026-10-01" }).success).toBe(false);
    expect(createCampaignSchema.safeParse({ name: "Valid name", channel: "meta", budget: 10 }).success).toBe(true);
  });
  it("metrics day: clicks cannot exceed impressions", () => {
    expect(metricsRowSchema.safeParse({ day: "2026-10-01", spend: 10, impressions: 5, clicks: 6 }).success).toBe(false);
    expect(metricsRowSchema.safeParse({ day: "2026-10-01", spend: 10, impressions: 5, clicks: 5 }).success).toBe(true);
  });
});

function fakeRepos(over: Partial<Repos["campaigns"]> = {}): { repos: Repos; calls: { create: unknown[]; update: unknown[]; days: unknown[] } } {
  const calls = { create: [] as unknown[], update: [] as unknown[], days: [] as unknown[] };
  const row = (x: Partial<CampaignRow> = {}) => ({ id: "c1", name: "N", version: 2, notes: null, ...x }) as CampaignRow;
  const repos: Repos = {
    campaigns: {
      create: async (_w, i) => { calls.create.push(i); return row({ name: (i as { name: string }).name, version: 1 }); },
      update: async (_w, id, v, p) => { calls.update.push([id, v, p]); return row({ version: v + 1 }); }, ...over,
    },
    segments: { create: async () => { throw new Error("n/a"); }, update: async () => { throw new Error("n/a"); } },
    metrics: { upsertDays: async (_w, r, s) => { calls.days.push([r.length, s]); return r.length; } },
  };
  return { repos, calls };
}
const ctx = (repos: Repos): Ctx => ({ ws: "ws-1", uid: "u-1", now: new Date("2026-10-31T10:00:00Z"), repos });

describe("campaign persistence", () => {
  it("generates the utm and stores draft with INR budget", async () => {
    const { repos, calls } = fakeRepos();
    const r = await createCampaign(ctx(repos), createCampaignSchema.parse({ name: "Madurai push", channel: "linkedin", district: "Madurai", theme: "Family law", budget: 75000 }), { created: (n) => `made ${n}` });
    expect(r.ok && r.data?.utmCampaign).toBe("li_madurai_family_law_202610");
    expect(calls.create[0]).toMatchObject({ status: "draft", budgetInr: 75000, utmCampaign: "li_madurai_family_law_202610", ownerId: "u-1" });
    expect(utmFor({ channel: "google_ads", district: "", theme: "" }, new Date("2026-01-05T00:00:00Z"))).toBe("gads_statewide_theme_202601");
  });
  it("retries a taken utm with a suffix, then gives up", async () => {
    let n = 0;
    const { repos } = fakeRepos({ create: async (_w, i) => { if (n++ < 1) throw new DbError("unique"); return { id: "c", version: 1, name: (i as { name: string }).name } as CampaignRow; } });
    const r = await createCampaign(ctx(repos), createCampaignSchema.parse({ name: "Madurai push", channel: "meta", budget: 5 }), { created: String });
    expect(r.ok && r.data?.utmCampaign).toMatch(/_2$/);
    const { repos: bad } = fakeRepos({ create: async () => { throw new DbError("unique"); } });
    await expect(createCampaign(ctx(bad), createCampaignSchema.parse({ name: "Madurai push", channel: "meta", budget: 5 }), { created: String })).rejects.toMatchObject({ code: "unique" });
  });
  it("edit sends the expected version and never touches utm or channel", async () => {
    const { repos, calls } = fakeRepos();
    const r = await editCampaign(ctx(repos), "c1", 4, { name: "Renamed one", budget: 9000 }, { saved: "ok" });
    expect(r.ok && r.data?.version).toBe(5);
    const patch = (calls.update[0] as [string, number, Record<string, unknown>])[2];
    expect(Object.keys(patch)).not.toContain("utmCampaign");
    expect(Object.keys(patch)).not.toContain("channel");
    expect((calls.update[0] as unknown[]).slice(0, 2)).toEqual(["c1", 4]);
  });
  it("a versioned write against a stale version is a conflict carrying the current row, not an overwrite", async () => {
    const { db, calls } = mockDb([ok([]), ok({ id: "c1", version: 7, name: "theirs" })]);
    const e = await updateVersioned("campaigns", "c1", 3, { name: "mine" }, { db, ws: "ws-1" }).catch((x) => x);
    expect(e).toBeInstanceOf(DbError);
    expect(e.code).toBe("conflict");
    expect(e.current).toMatchObject({ version: 7 });
    expect(has(calls[0], "eq", "version", 3)).toBe(true);
  });
  it("note appends with the date and keeps earlier notes", async () => {
    const { repos, calls } = fakeRepos();
    await addNote(ctx(repos), { id: "c1", notes: "first" } as CampaignRow, 2, "second", { saved: "ok" });
    expect((calls.update[0] as [string, number, { notes: string }])[2].notes).toBe("first\n2026-10-31: second");
  });
  it("csv import upserts once per call with source csv", async () => {
    const { repos, calls } = fakeRepos();
    const r = await importMetrics(ctx(repos), [{ campaignId: "c1", day: "2026-10-01", spend: 1, impressions: 0, reach: 0, clicks: 0, reactions: 0, comments: 0, shares: 0, opens: 0, bounces: 0, unsubscribes: 0, platformLeads: 0 }], { done: (n) => `${n}` });
    expect(r.ok && r.data?.written).toBe(1);
    expect(calls.days[0]).toEqual([1, "csv"]);
  });
});

describe("export csv", () => {
  it("neutralises formulas and quotes", () => {
    expect(toCsv(["name", "phone"], [["=SUM(A1)", "+91 99"], ['a "b", c', null]])).toBe('name,phone\n\'=SUM(A1),\'+91 99\n"a ""b"", c",');
  });
});
