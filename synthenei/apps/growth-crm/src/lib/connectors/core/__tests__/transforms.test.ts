import { describe, expect, it } from "vitest";
import { TRANSFORMS, dateIst, e164Phone, hashSha256, inrPaiseToRupees, lowerEmail, microsToRupees, stageKeyMap } from "../transforms";
import { applyFieldMap, effectiveMap, encodeTransform, validateFieldMap } from "../field-map";
import { stripPii } from "../pii";
import type { FieldMapSpec } from "../types";

describe("transforms", () => {
  it("e164_phone defaults to India and rejects junk", () => {
    expect(e164Phone("98450 12345")).toBe("+919845012345");
    expect(e164Phone("+44 20 7946 0958")).toBe("+442079460958");
    expect(e164Phone("12")).toBeNull();
    expect(e164Phone("")).toBeNull();
  });
  it("lower_email trims, lowers and validates", () => {
    expect(lowerEmail("  Mock1@Example.TEST ")).toBe("mock1@example.test");
    expect(lowerEmail("not-an-email")).toBeNull();
  });
  it("money transforms are exact", () => {
    expect(inrPaiseToRupees(150050)).toBe(1500.5);
    expect(inrPaiseToRupees("1,00,000")).toBe(1000);
    expect(inrPaiseToRupees("x")).toBeNull();
    expect(microsToRupees(2_500_000)).toBe(2.5);
  });
  it("date_ist moves a late UTC timestamp to the next IST day", () => {
    expect(dateIst("2026-03-01T19:00:00Z")).toBe("2026-03-02");
    expect(dateIst("garbage")).toBeNull();
  });
  it("stage_key_map maps, ignores case, falls back or returns null", () => {
    const arg = { map: { "Closed Won": "won", Open: "new" }, fallback: "new" };
    expect(stageKeyMap("Closed Won", arg)).toBe("won");
    expect(stageKeyMap("open", arg)).toBe("new");
    expect(stageKeyMap("Weird", arg)).toBe("new");
    expect(stageKeyMap("Weird", { map: {} })).toBeNull();
  });
  it("hash_sha256 normalises case and whitespace", () => {
    expect(hashSha256(" A@B.com ")).toBe(hashSha256("a@b.com"));
    expect(Object.keys(TRANSFORMS)).toHaveLength(8);
  });
});

const MAP: FieldMapSpec[] = [
  { externalObject: "Deal", externalField: "amount", localTable: "deals", localColumn: "value", direction: "in", transform: "inr_paise_to_rupees" },
  { externalObject: "Deal", externalField: "stage", localTable: "deals", localColumn: "stage_key", direction: "in", transform: "stage_key_map", transformArg: { map: { Won: "won" } } },
  { externalObject: "Deal", externalField: "owner.email", localTable: "deals", localColumn: "owner_email", direction: "in", transform: "lower_email" },
  { externalObject: "Deal", externalField: "note", localTable: "deals", localColumn: "note", direction: "out" },
];

describe("field-map engine", () => {
  it("applies transforms, nested paths and direction", () => {
    const r = applyFieldMap(MAP, "Deal", { amount: 250000, stage: "Won", owner: { email: "A@X.IN" }, note: "n" });
    expect(r.byTable.deals).toEqual({ value: 2500, stage_key: "won", owner_email: "a@x.in" });
    expect(r.rejected).toEqual([]);
  });
  it("reports a failing transform and skips missing fields", () => {
    const r = applyFieldMap(MAP, "Deal", { amount: "abc", stage: "Unknown" });
    expect(r.byTable.deals ?? {}).toEqual({});
    expect(r.rejected.map((x) => x.field).sort()).toEqual(["amount", "stage"]);
  });
  it("tenant rows replace defaults for the same external field", () => {
    const merged = effectiveMap(MAP, [{ ...MAP[0], localColumn: "value_inr" }]);
    expect(merged).toHaveLength(4);
    expect(applyFieldMap(merged, "Deal", { amount: 100 }).byTable.deals).toEqual({ value_inr: 1 });
  });
  it("validates an edited map", () => {
    const bad = validateFieldMap([
      { ...MAP[0], localTable: "secrets" },
      { ...MAP[0], localColumn: "Bad Col" },
      { ...MAP[1], transformArg: null },
      { ...MAP[0], transform: "rm_rf" as never },
    ], ["deals", "leads"]);
    expect(bad.map((b) => b.message)).toEqual(expect.arrayContaining(["table_not_allowed", "column_invalid", "stage_map_required", "transform_unknown", "duplicate"]));
    expect(validateFieldMap(MAP, ["deals"])).toEqual([]);
  });
  it("encodes the transform column", () => {
    expect(encodeTransform("e164_phone")).toBe("e164_phone");
    expect(encodeTransform("stage_key_map", { map: { A: "b" } })).toBe('stage_key_map:{"map":{"A":"b"}}');
    expect(encodeTransform(null)).toBeNull();
  });
});

describe("stripPii", () => {
  it("masks personal fields and secrets and caps at 2 KB", () => {
    const v = stripPii({ name: "Asha K", email: "a@b.com", note: "call +91 98450 12345", api_key: "sk_live_abcdefghijklmnop", stage: "new" }) as Record<string, string>;
    expect(JSON.stringify(v)).not.toMatch(/Asha|a@b\.com|98450|sk_live/);
    expect(v.stage).toBe("new");
    const big = stripPii(Array.from({ length: 400 }, (_, i) => ({ stage: `stage-${i}`, city: "Madurai" })));
    expect(JSON.stringify(big).length).toBeLessThanOrEqual(2048);
  });
});
