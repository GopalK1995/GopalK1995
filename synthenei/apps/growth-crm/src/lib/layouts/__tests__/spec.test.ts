import { describe, expect, it } from "vitest";
import { def } from "@/lib/metadata/__tests__/fixtures";
import { defaultDetailSpec, defaultListSpec, normalizeDetailSpec, normalizeListSpec, validateSpec } from "../spec";

const defs = [
  def({ key: "name", type: "text", required: true, position: 0 }),
  def({ key: "status", type: "select", section: "Details", position: 1 }),
  def({ key: "qty", type: "number", section: "Details", position: 2 }),
  def({ key: "notes", type: "long_text", section: "Notes", position: 3 }),
  def({ key: "old", type: "text", position: 4, archivedAt: "2026-01-01T00:00:00Z" }),
];

describe("default specs", () => {
  it("groups fields by their section, never places the primary field or retired fields", () => {
    const s = defaultDetailSpec(defs, "name");
    expect(s.sections.map((x) => [x.title, x.fields])).toEqual([["Details", ["status", "qty"]], ["Notes", ["notes"]]]);
    expect(s.showRelated && s.showComments).toBe(true);
  });
  it("puts fields without a section first under the untitled name", () => {
    const s = defaultDetailSpec([def({ key: "a", type: "text", position: 5 }), def({ key: "b", type: "text", section: "Z", position: 1 })], null, "General");
    expect(s.sections[0]).toMatchObject({ title: "General", fields: ["a"] });
  });
  it("list default is the title plus up to four non-long-text fields", () => {
    expect(defaultListSpec(defs, "name").columns).toEqual(["title", "custom.status", "custom.qty"]);
    expect(defaultListSpec(defs, "name", 1).columns).toEqual(["title", "custom.status"]);
  });
});

describe("normalisers drop what no longer exists", () => {
  it("detail: unknown, retired, primary and duplicate keys are removed", () => {
    const n = normalizeDetailSpec({ sections: [{ id: "a", title: " A ", fields: ["status", "ghost", "old", "name", "qty"] }, { title: "B", fields: ["qty", "notes"] }], showComments: false }, defs, "name");
    expect(n.sections.map((s) => s.fields)).toEqual([["status", "qty"], ["notes"]]);
    expect(n.sections[0].title).toBe("A");
    expect(n.showComments).toBe(false);
    expect(n.showRelated).toBe(true);
  });
  it("detail: garbage input yields an empty, valid spec", () => {
    expect(normalizeDetailSpec("x", defs, "name").sections).toEqual([]);
    expect(normalizeDetailSpec({ sections: [null, 3, { fields: "no" }] }, defs, "name").sections).toHaveLength(1);
  });
  it("list: keeps the title column, removes unknown and duplicate columns, caps the count", () => {
    expect(normalizeListSpec({ columns: ["custom.qty", "custom.ghost", "custom.qty", "title"] }, defs, "name").columns).toEqual(["custom.qty", "title"]);
    expect(normalizeListSpec({ columns: ["custom.qty"] }, defs, "name").columns).toEqual(["title", "custom.qty"]);
    expect(normalizeListSpec(null, defs, "name").columns).toEqual(["title"]);
  });
});

describe("validateSpec (strict, used on save)", () => {
  it("accepts a good detail layout", () => {
    expect(validateSpec("detail", { sections: [{ title: "A", fields: ["status"] }] }, defs, "name")).toEqual([]);
  });
  it("rejects an untitled section, an unknown field and a field placed twice", () => {
    const issues = validateSpec("detail", { sections: [{ title: " ", fields: ["status"] }, { title: "B", fields: ["ghost", "status"] }] }, defs, "name");
    expect(issues.map((i) => i.message)).toEqual(expect.arrayContaining(["Every section needs a title", 'Unknown field "ghost"', 'Field "status" is placed twice']));
  });
  it("rejects the primary field and retired fields in a section", () => {
    expect(validateSpec("detail", { sections: [{ title: "A", fields: ["name", "old"] }] }, defs, "name")).toHaveLength(2);
  });
  it("list needs the title column and known columns", () => {
    expect(validateSpec("list", { columns: ["custom.qty"] }, defs, "name").map((i) => i.message)).toContain("The primary column cannot be removed");
    expect(validateSpec("list", { columns: ["title", "custom.ghost"] }, defs, "name")).toHaveLength(1);
    expect(validateSpec("list", { columns: ["title", "title"] }, defs, "name").map((i) => i.message)).toContain("A column is listed twice");
    expect(validateSpec("list", { columns: ["title", "custom.qty"] }, defs, "name")).toEqual([]);
  });
  it("rejects a non-object spec and a missing list", () => {
    expect(validateSpec("detail", null, defs)).toHaveLength(1);
    expect(validateSpec("detail", {}, defs)).toHaveLength(1);
    expect(validateSpec("list", {}, defs)).toHaveLength(1);
  });
  it("caps sections and columns", () => {
    const secs = Array.from({ length: 13 }, (_, i) => ({ title: `S${i}`, fields: [] }));
    expect(validateSpec("detail", { sections: secs }, defs).map((i) => i.message)).toContain("At most 12 sections");
    const cols = ["title", ...Array.from({ length: 12 }, (_, i) => `custom.c${i}`)];
    expect(validateSpec("list", { columns: cols }, defs).map((i) => i.message)).toContain("At most 12 columns");
  });
});
