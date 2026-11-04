import { describe, expect, it } from "vitest";
import { def } from "@/lib/metadata/__tests__/fixtures";
import { canEditView, effectiveQuery, resolveView, sanitizeView } from "../views";
import type { SavedView } from "../types";

const defs = [
  def({ key: "status", type: "select", options: { choices: [{ key: "new", label: { en: "New" } }] } }),
  def({ key: "qty", type: "number" }),
  def({ key: "gone", type: "text", archivedAt: "2026-01-01T00:00:00Z" }),
  def({ key: "plain", type: "text", isFilterable: false }),
];
const view = (p: Partial<SavedView> = {}): SavedView => ({ id: "v1", objectTypeId: "o1", ownerId: "u1", name: "V", filters: {}, sort: [], columns: [], visibility: "private", position: 0, ...p });
const q = { q: "", filters: {}, sort: [], viewId: null };

describe("sanitizeView", () => {
  it("keeps valid filters, columns and sort; drops unknown, retired and non-filterable fields and bad operators", () => {
    const { value, issues } = sanitizeView(defs, {
      name: " Mine ", visibility: "private",
      filters: { "custom.status": { op: "eq", value: "new" }, "custom.gone": { op: "eq", value: "x" }, "custom.plain": { op: "eq", value: "x" }, "custom.qty": { op: "contains", value: "1" }, "custom.ghost": { op: "eq", value: "x" } },
      columns: ["custom.qty", "custom.gone", "custom.ghost", "custom.qty"], sort: [{ id: "custom.qty", desc: true }, { id: "custom.gone", desc: false }],
    }, false);
    expect(issues).toEqual([]);
    expect(value.name).toBe("Mine");
    expect(Object.keys(value.filters)).toEqual(["custom.status"]);
    expect(value.columns).toEqual(["title", "custom.qty"]);
    expect(value.sort).toEqual([{ id: "custom.qty", desc: true }]);
  });
  it("sharing a view needs the share permission", () => {
    expect(sanitizeView(defs, { name: "x", visibility: "workspace" }, false).issues).toEqual([{ path: "visibility", code: "share" }]);
    expect(sanitizeView(defs, { name: "x", visibility: "team" }, false).issues).toEqual([{ path: "visibility", code: "share" }]);
    expect(sanitizeView(defs, { name: "x", visibility: "workspace" }, true).issues).toEqual([]);
    expect(sanitizeView(defs, { name: "x" }, false).value.visibility).toBe("private");
  });
  it("rejects an empty or over-long name and an unknown visibility", () => {
    expect(sanitizeView(defs, { name: "  " }, true).issues[0].code).toBe("name");
    expect(sanitizeView(defs, { name: "x".repeat(81) }, true).issues[0].code).toBe("name");
    expect(sanitizeView(defs, { name: "x", visibility: "public" }, true).issues[0].code).toBe("visibility");
  });
  it("tolerates garbage payloads", () => {
    const r = sanitizeView(defs, { name: "x", filters: "no", columns: 3, sort: [null, 4, { id: 1 }] }, true);
    expect(r.issues).toEqual([]);
    expect(r.value).toMatchObject({ filters: {}, columns: [], sort: [] });
  });
});

describe("resolving a view", () => {
  it("drops retired fields on load", () => {
    const r = resolveView(defs, view({ columns: ["title", "custom.qty", "custom.gone"], filters: { "custom.gone": { op: "eq", value: "x" }, "custom.status": { op: "eq", value: "new" } }, sort: [{ id: "custom.gone", desc: true }] }));
    expect(r.columns).toEqual(["title", "custom.qty"]);
    expect(Object.keys(r.filters)).toEqual(["custom.status"]);
    expect(r.sort).toEqual([]);
  });
  it("URL filters and sort override the view; the view fills the rest", () => {
    const v = view({ filters: { "custom.status": { op: "eq", value: "new" } }, sort: [{ id: "custom.qty", desc: false }], columns: ["title", "custom.qty"] });
    const e = effectiveQuery(defs, { ...q, filters: { "custom.status": { op: "eq", value: "done" } }, sort: [{ id: "title", desc: true }] }, v);
    expect(e.filters["custom.status"].value).toBe("done");
    expect(e.sort).toEqual([{ id: "title", desc: true }]);
    expect(e.columns).toEqual(["title", "custom.qty"]);
    expect(effectiveQuery(defs, q, v).sort).toEqual([{ id: "custom.qty", desc: false }]);
    expect(effectiveQuery(defs, q, null)).toEqual({ filters: {}, sort: [], columns: [] });
  });
});

describe("who may edit a view", () => {
  it("the owner, or anyone who can share views", () => {
    expect(canEditView({ ownerId: "u1" }, "u1", false)).toBe(true);
    expect(canEditView({ ownerId: "u1" }, "u2", false)).toBe(false);
    expect(canEditView({ ownerId: "u1" }, "u2", true)).toBe(true);
    expect(canEditView({ ownerId: null }, "u2", false)).toBe(false);
  });
});
