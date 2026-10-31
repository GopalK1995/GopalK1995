import { describe, expect, it } from "vitest";
import { columnId, filtersToParams, fromSavedView, keyOfColumn, matchesFilter, opsFor, parseFilterParams, toQueryEntries, toSavedView } from "../filters";
import { def } from "./fixtures";

const defs = [
  def({ key: "source", type: "select", options: { choices: [{ key: "web", label: { en: "Web" } }, { key: "ref", label: { en: "Referral" } }] } }),
  def({ key: "notes", type: "long_text" }),
  def({ key: "city", type: "text" }),
  def({ key: "hidden_filter", type: "text", isFilterable: false }),
  def({ key: "gone", type: "text", archivedAt: "2026-10-01T00:00:00Z" }),
  def({ key: "tags", type: "multi_select", options: { choices: [{ key: "a", label: { en: "A" } }, { key: "b", label: { en: "B" } }] } }),
];

describe("filters match the public API grammar", () => {
  it("emits filter[custom.key] and filter[custom.key][op]", () => {
    expect(toQueryEntries({ [columnId("source")]: { op: "eq", value: "web" }, [columnId("city")]: { op: "contains", value: "chen" }, [columnId("tags")]: { op: "in", value: ["a", "b"] } }))
      .toEqual([["filter[custom.source]", "web"], ["filter[custom.city][contains]", "chen"], ["filter[custom.tags][in]", "a,b"]]);
  });
  it("skips empty values and malformed keys", () => {
    expect(toQueryEntries({ "custom.source": { op: "eq", value: "" }, "custom.Bad Key": { op: "eq", value: "x" }, name: { op: "eq", value: "x" } })).toEqual([]);
  });
  it("operators per type stay within what the API accepts for custom fields", () => {
    for (const d of defs) for (const op of opsFor(d)) expect(["eq", "neq", "in", "contains"]).toContain(op);
  });
});

describe("page params and saved views", () => {
  it("parses only filterable, active fields", () => {
    const sp = new URLSearchParams({ "custom.source": "web", "custom.notes": "x", "custom.hidden_filter": "y", "custom.gone": "z", "custom.city": "Madurai", "custom.city.op": "contains", "custom.source.op": "bogus" });
    expect(parseFilterParams(defs, sp)).toEqual({ "custom.source": { op: "in", value: ["web"] }, "custom.city": { op: "contains", value: "Madurai" } });
  });
  it("round trips through params", () => {
    const f = { "custom.city": { op: "contains" as const, value: "x" } };
    expect(parseFilterParams(defs, new URLSearchParams(filtersToParams(f)))).toEqual(f);
  });
  it("saved views keep working when a field is retired: dead columns and filters are dropped on load", () => {
    const saved = toSavedView(["name", "custom.source", "custom.gone"], { "custom.gone": { op: "eq", value: "z" }, "custom.source": { op: "eq", value: "web" } });
    expect(saved.columns).toEqual(["custom.source", "custom.gone"]);
    const live = fromSavedView(defs, { columns: ["name", ...saved.columns], filters: saved.filters });
    expect(live.columns).toEqual(["name", "custom.source"]);
    expect(Object.keys(live.filters)).toEqual(["custom.source"]);
  });
  it("column ids", () => {
    expect(keyOfColumn(columnId("source"))).toBe("source");
    expect(keyOfColumn("name")).toBeNull();
  });
});

describe("matchesFilter (demo and client-side evaluation)", () => {
  it("eq, neq, in, contains", () => {
    expect(matchesFilter({ type: "select" }, { op: "eq", value: "web" }, "web")).toBe(true);
    expect(matchesFilter({ type: "select" }, { op: "neq", value: "web" }, "ref")).toBe(true);
    expect(matchesFilter({ type: "select" }, { op: "in", value: ["web", "ref"] }, "ref")).toBe(true);
    expect(matchesFilter({ type: "text" }, { op: "contains", value: "CHEN" }, "Chennai")).toBe(true);
    expect(matchesFilter({ type: "multi_select" }, { op: "contains", value: ["a", "b"] }, ["a", "b", "c"])).toBe(true);
    expect(matchesFilter({ type: "multi_select" }, { op: "contains", value: ["a", "z"] }, ["a"])).toBe(false);
    expect(matchesFilter({ type: "select" }, { op: "eq", value: "web" }, null)).toBe(false);
  });
});
