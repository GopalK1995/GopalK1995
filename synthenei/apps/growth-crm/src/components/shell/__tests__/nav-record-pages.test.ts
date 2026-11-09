import { describe, expect, it } from "vitest";
import { NAV, navFor } from "../nav";
import { pagePermission, PAGE_PERMISSION } from "@/lib/authz";
import { permissionDef } from "@/lib/authz/catalog";

const hrefs = (r: Parameters<typeof navFor>[0]) => navFor(r).flatMap((g) => g.items.map((i) => i.href));

describe("nav entries added after INTEG1", () => {
  it("no duplicate hrefs in the nav", () => {
    const all = NAV.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(all).size).toBe(all.length);
  });
  it("import, pipelines and email sending are gated by their permissions, not by role names", () => {
    expect(hrefs("owner")).toEqual(expect.arrayContaining(["/import", "/settings/pipelines", "/settings/email"]));
    expect(hrefs("data")).toContain("/import");
    expect(hrefs("viewer")).not.toContain("/import");
    expect(hrefs("sales_rep")).not.toContain("/settings/pipelines");
    expect(hrefs("marketing")).not.toContain("/settings/pipelines");
  });
});

describe("page permissions for pages added after the legacy matrix", () => {
  const cases: [string, string][] = [
    ["/import", "leads.import"], ["/settings/pipelines", "pipelines.manage"], ["/settings/objects", "objects.manage"], ["/settings/layouts", "layouts.manage"],
    ["/settings/fields", "fields.manage"], ["/settings/email", "integrations.manage"], ["/o/events/abc", "obj:events.read"], ["/settings", "settings.read"],
  ];
  it.each(cases)("%s needs %s", (path, perm) => expect(pagePermission(path)).toBe(perm));
  it("every mapped permission exists in the catalogue (object permissions are dynamic)", () => {
    for (const p of Object.values(PAGE_PERMISSION)) expect(permissionDef(p), p).toBeTruthy();
  });
});
