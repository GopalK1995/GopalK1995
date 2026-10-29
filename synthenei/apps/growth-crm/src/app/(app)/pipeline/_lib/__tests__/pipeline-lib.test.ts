import { describe, expect, it } from "vitest";
import { createDealsRepo } from "@/lib/db/repo/deals";
import { mockDb, ok, has } from "@/lib/db/__tests__/mock";
import { DbError } from "@/lib/db/errors";
import { buildMovePatch, persistMove } from "../move";
import { stageAgeTicks } from "../stage-age";
import { fill, pipelineLabels, PIPELINE_BASE } from "../labels";

const NOW = new Date("2026-10-29T10:00:00Z");

describe("stageAgeTicks", () => {
  it("draws one tick per day and marks ticks past the limit", () => {
    const m = stageAgeTicks(16, 14);
    expect(m.ticks).toHaveLength(16);
    expect(m.ticks.filter((t) => t.over)).toHaveLength(2);
    expect(m.over).toBe(true);
  });
  it("is not over at exactly the limit, and caps the row with an overflow count", () => {
    expect(stageAgeTicks(14, 14).over).toBe(false);
    const m = stageAgeTicks(40, 14);
    expect(m.ticks).toHaveLength(21);
    expect(m.overflow).toBe(19);
  });
  it("survives bad input", () => {
    expect(stageAgeTicks(-3, 0).ticks).toHaveLength(0);
    expect(stageAgeTicks(Number.NaN).days).toBe(0);
  });
});

describe("buildMovePatch", () => {
  it("won writes timestamp, value, seats, start date and a DB plan key", () => {
    const p = buildMovePatch("won", { won: { plan: "Chambers", seats: 12, value: 90000, start: "2026-11-01" } }, NOW.toISOString());
    expect(p).toMatchObject({ wonAt: NOW.toISOString(), valueInr: 90000, seats: 12, expectedCloseOn: "2026-11-01", plan: "chambers" });
  });
  it("won leaves the plan out when the vertical plan is not a DB key", () => {
    const p = buildMovePatch("won", { won: { plan: "Suite", seats: 2, value: 5000, start: "2026-11-01" } }, NOW.toISOString());
    expect(p).not.toHaveProperty("plan");
  });
  it("lost writes reason and trimmed competitor; other stages write nothing", () => {
    expect(buildMovePatch("lost", { lost: { reason: "price", competitor: "  Acme  " } }, NOW.toISOString())).toEqual({ lostAt: NOW.toISOString(), lostReason: "price", competitor: "Acme" });
    expect(buildMovePatch("proposal", undefined, NOW.toISOString())).toEqual({});
  });
});

describe("persistMove (deals repository, mocked client)", () => {
  it("sends the expected version and the won columns together with the stage", async () => {
    const { db, calls } = mockDb([ok({ id: "d1", tenant_id: "t", version: 3 }), ok({ id: "s-won" }), ok([{ id: "d1", stage_id: "s-won", version: 4 }])]);
    const saved = await persistMove(createDealsRepo(async () => db), { ws: "w", id: "d1", to: "won", expectedVersion: 3, extra: { won: { plan: "Practice", seats: 3, value: 1000, start: "2026-11-01" } }, now: NOW });
    expect(saved).toMatchObject({ stageId: "s-won", version: 4 });
    const upd = calls.find((c) => c.ops.some(([o]) => o === "update"))!;
    expect(has(upd, "eq", "version", 3)).toBe(true);
    const body = upd.ops.find(([o]) => o === "update")![1][0] as Record<string, unknown>;
    expect(body).toMatchObject({ stage_id: "s-won", won_at: NOW.toISOString(), value_inr: 1000, seats: 3 });
  });
  it("a stale version surfaces a conflict carrying the current row", async () => {
    const { db } = mockDb([ok({ id: "d1", tenant_id: "t", version: 5 }), ok({ id: "s2" }), ok([]), ok({ id: "d1", version: 5, stage_id: "other" })]);
    const err = await persistMove(createDealsRepo(async () => db), { ws: "w", id: "d1", to: "proposal", expectedVersion: 3 }).catch((e) => e);
    expect(err).toBeInstanceOf(DbError);
    expect(err.code).toBe("conflict");
    expect(err.current).toMatchObject({ version: 5 });
  });
});

describe("labels", () => {
  it("applies the vertical nouns and never mixes tenants", () => {
    const legal = pipelineLabels("en", { deal: "deal", deals: "deals" });
    const hosp = pipelineLabels("en", { deal: "booking", deals: "bookings" });
    expect(legal.denied).toContain("deals");
    expect(hosp.denied).toContain("bookings");
    expect(hosp.denied).not.toContain("deals");
    expect(hosp.conflictTitle).toContain("{owner}");
  });
  it("fills placeholders and every Tamil key exists in English", () => {
    expect(fill("{n} days", { n: 3 })).toBe("3 days");
    expect(Object.keys(PIPELINE_BASE.ta).sort()).toEqual(Object.keys(PIPELINE_BASE.en).sort());
  });
  it("has no em dashes in either locale", () => {
    for (const l of ["en", "ta"] as const) for (const s of Object.values(PIPELINE_BASE[l])) expect(s).not.toContain("—");
  });
});
