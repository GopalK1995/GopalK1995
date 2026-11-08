import { describe, expect, it } from "vitest";
import { def } from "@/lib/metadata/__tests__/fixtures";
import { applyFilters, displayTitle, needsMemoryPass, parseListQuery, sortRecords, sortToParam } from "../query";
import type { ObjectRecord } from "../types";

const defs = [
  def({ key: "name", type: "text" }),
  def({ key: "status", type: "select", options: { choices: [{ key: "new", label: { en: "New" } }, { key: "done", label: { en: "Done" } }] } }),
  def({ key: "tags", type: "multi_select", options: { choices: [{ key: "a", label: { en: "A" } }, { key: "b", label: { en: "B" } }] } }),
  def({ key: "qty", type: "number" }),
  def({ key: "hidden", type: "text", isFilterable: false }),
];
const rec = (id: string, data: Record<string, unknown>, title = ""): ObjectRecord => ({ id, title, data, ownerId: null, version: 1, createdAt: "", updatedAt: `2026-01-0${id}T00:00:00Z` });
const rows = [rec("1", { name: "Alpha", status: "new", qty: 5, tags: ["a"] }), rec("2", { name: "Bravo", status: "done", qty: 20, tags: ["a", "b"] }), rec("3", { name: "Charlie", qty: null })];

describe("parseListQuery", () => {
  it("reads q, view, sort and custom filters; ignores unknown, retired and non-filterable fields", () => {
    const p = new URLSearchParams("q=  al  &view=v1&sort=custom.qty:desc&custom.status=new&custom.ghost=x&custom.hidden=y");
    const q = parseListQuery(defs, p);
    expect(q.q).toBe("al");
    expect(q.viewId).toBe("v1");
    expect(q.sort).toEqual([{ id: "custom.qty", desc: true }]);
    expect(Object.keys(q.filters)).toEqual(["custom.status"]);
  });
  it("drops a sort on an unknown column", () => {
    expect(parseListQuery(defs, new URLSearchParams("sort=custom.ghost:asc")).sort).toEqual([]);
    expect(parseListQuery(defs, new URLSearchParams("sort=title:asc")).sort).toEqual([{ id: "title", desc: false }]);
  });
  it("sortToParam round-trips", () => {
    expect(sortToParam([{ id: "custom.qty", desc: true }])).toBe("custom.qty:desc");
    expect(sortToParam([])).toBe("");
  });
});

describe("filters", () => {
  it("eq, in and contains evaluate like the API", () => {
    expect(applyFilters(rows, defs, { "custom.status": { op: "eq", value: "new" } }).map((r) => r.id)).toEqual(["1"]);
    expect(applyFilters(rows, defs, { "custom.status": { op: "in", value: ["new", "done"] } }).map((r) => r.id)).toEqual(["1", "2"]);
    expect(applyFilters(rows, defs, { "custom.name": { op: "contains", value: "RAV" } }).map((r) => r.id)).toEqual(["2"]);
  });
  it("neq keeps rows with no value; multi-select contains needs every wanted value", () => {
    expect(applyFilters(rows, defs, { "custom.status": { op: "neq", value: "new" } }).map((r) => r.id)).toEqual(["2", "3"]);
    expect(applyFilters(rows, defs, { "custom.tags": { op: "contains", value: ["a", "b"] } }).map((r) => r.id)).toEqual(["2"]);
  });
  it("search matches the display title (primary field first)", () => {
    expect(applyFilters(rows, defs, {}, "charl", "name").map((r) => r.id)).toEqual(["3"]);
  });
  it("ignores a filter on a field that no longer exists", () => {
    expect(applyFilters(rows, defs, { "custom.ghost": { op: "eq", value: "x" } })).toHaveLength(3);
  });
  it("flags the operators the database cannot express exactly", () => {
    expect(needsMemoryPass(defs, { "custom.status": { op: "neq", value: "new" } })).toBe(true);
    expect(needsMemoryPass(defs, { "custom.tags": { op: "contains", value: "a" } })).toBe(true);
    expect(needsMemoryPass(defs, { "custom.status": { op: "eq", value: "new" } })).toBe(false);
  });
});

describe("sort and title", () => {
  it("sorts numbers numerically and keeps empty values last in both directions", () => {
    expect(sortRecords(rows, [{ id: "custom.qty", desc: false }]).map((r) => r.id)).toEqual(["1", "2", "3"]);
    expect(sortRecords(rows, [{ id: "custom.qty", desc: true }]).map((r) => r.id)).toEqual(["2", "1", "3"]);
  });
  it("sorts by title and by updated time; no sort keeps the input order", () => {
    expect(sortRecords(rows, [{ id: "title", desc: true }], "name").map((r) => r.id)).toEqual(["3", "2", "1"]);
    expect(sortRecords(rows, [{ id: "updated_at", desc: true }]).map((r) => r.id)).toEqual(["3", "2", "1"]);
    expect(sortRecords(rows, []).map((r) => r.id)).toEqual(["1", "2", "3"]);
  });
  it("does not mutate its input", () => {
    const copy = [...rows];
    sortRecords(rows, [{ id: "custom.qty", desc: true }]);
    expect(rows).toEqual(copy);
  });
  it("display title prefers the primary field, falls back to the stored title", () => {
    expect(displayTitle(rec("9", { name: " New name " }, "Old"), "name")).toBe(" New name ");
    expect(displayTitle(rec("9", {}, "Stored"), "name")).toBe("Stored");
    expect(displayTitle(rec("9", { name: 3 }, "Stored"), "name")).toBe("Stored");
  });
});
