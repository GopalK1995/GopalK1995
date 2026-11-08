import { describe, expect, it } from "vitest";
import { demoAccess, demoFields, demoLayouts, demoObject, demoRecords, demoViews, DEMO_OBJECT_KEY } from "../demo";
import { hrefFor, otherEnd } from "../links";
import { normalizeDetailSpec } from "@/lib/layouts/spec";
import { validateCustom } from "@/lib/metadata/validate";
import { pickLayout } from "@/lib/layouts/resolve";
import { resolveView } from "../views";

describe("demo fixtures stay consistent", () => {
  it("every demo record validates against the demo field definitions", () => {
    for (const r of demoRecords()) expect(validateCustom(demoFields(), r.data, "create").issues, r.id).toEqual([]);
  });
  it("the primary field exists, is required and is text", () => {
    const f = demoFields().find((x) => x.key === demoObject().primaryField);
    expect(f).toMatchObject({ type: "text", required: true });
  });
  it("demo layouts and views reference only live fields", () => {
    const defs = demoFields();
    for (const l of demoLayouts()) {
      const n = normalizeDetailSpec(l.spec, defs, demoObject().primaryField);
      expect(n.sections.flatMap((s) => s.fields)).toEqual((l.spec as { sections: { fields: string[] }[] }).sections.flatMap((s) => s.fields));
    }
    for (const v of demoViews()) expect(resolveView(defs, v)).toEqual(v);
  });
  it("the sales rep sees the role layout, others see none (so the default applies)", () => {
    const q = { objectTypeId: demoObject().id, kind: "detail" as const, workspaceId: "ws", roleIds: ["sales_rep"] };
    expect(pickLayout(demoLayouts(), q)?.id).toBe("demo-layout-rep");
    expect(pickLayout(demoLayouts(), { ...q, roleIds: ["owner"] })).toBeNull();
  });
  it("demo grants mirror the database defaults for a new custom object", () => {
    expect(demoAccess("owner")).toEqual({ read: true, write: true, delete: true });
    expect(demoAccess("sales_manager")).toEqual({ read: true, write: true, delete: false });
    expect(demoAccess("sales_rep")).toEqual({ read: true, write: false, delete: false });
    for (const r of ["marketing", "data", "viewer"] as const) expect(demoAccess(r)).toEqual({ read: false, write: false, delete: false });
  });
  it("is generic: no tenant or brand names in the example data", () => {
    expect(JSON.stringify([demoObject(), demoFields(), demoRecords(), demoViews()])).not.toMatch(/lawsome|kaveri|shola/i);
    expect(DEMO_OBJECT_KEY).toMatch(/^example_/);
  });
});

describe("links", () => {
  const link = { id: "l", fromType: "obj:a", fromId: "1", toType: "obj:b", toId: "2", relation: "related" };
  it("finds the other end from either side", () => {
    expect(otherEnd(link, "obj:a", "1")).toEqual({ direction: "to", type: "obj:b", id: "2" });
    expect(otherEnd(link, "obj:b", "2")).toEqual({ direction: "from", type: "obj:a", id: "1" });
  });
  it("links to custom records open under /o, system records on their pages, unknown types nowhere", () => {
    expect(hrefFor("obj:things", "9")).toBe("/o/things/9");
    expect(hrefFor("lead", "9")).toBe("/leads/9");
    expect(hrefFor("account", "9")).toBe("/accounts/9");
    expect(hrefFor("segment", "9")).toBeNull();
  });
});
