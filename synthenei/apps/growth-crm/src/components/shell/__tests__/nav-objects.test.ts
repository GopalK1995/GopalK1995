import { describe, expect, it } from "vitest";
import { navFor, type NavObject } from "../nav";
import { objectPermissionDefs } from "@/lib/layouts/object-perms";
import { isObjectPermission } from "@/lib/authz/catalog";
import { pagePermission } from "@/lib/authz";

const objects: NavObject[] = [{ key: "site_visit", label: "Site visits", icon: "building" }, { key: "x", label: "Odd", icon: "not-an-icon" }];

describe("nav entries for custom objects", () => {
  it("adds one Records group before Admin, linking to /o/<key>, with allow-listed icons only", () => {
    const g = navFor("owner", undefined, objects);
    const names = g.map((x) => x.group);
    expect(names.indexOf("Records")).toBe(names.indexOf("Admin") - 1);
    const rec = g.find((x) => x.group === "Records")!;
    expect(rec.items.map((i) => [i.href, i.label])).toEqual([["/o/site_visit", "Site visits"], ["/o/x", "Odd"]]);
    expect(rec.items.every((i) => typeof i.icon === "object" || typeof i.icon === "function")).toBe(true);
  });
  it("no objects, no group; the existing nav is unchanged", () => {
    expect(navFor("owner").find((x) => x.group === "Records")).toBeUndefined();
    expect(navFor("owner", undefined, [])).toEqual(navFor("owner"));
  });
  it("the settings entries are gated by their permissions, not by role names", () => {
    const hrefs = (r: Parameters<typeof navFor>[0]) => navFor(r).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs("owner")).toEqual(expect.arrayContaining(["/settings/objects", "/settings/layouts", "/settings/fields"]));
    for (const r of ["sales_rep", "marketing", "viewer"] as const) expect(hrefs(r)).not.toContain("/settings/objects");
  });
});

describe("object permissions", () => {
  it("each object contributes read, write and delete in the dynamic permission format", () => {
    const defs = objectPermissionDefs([{ key: "site_visit", label: "Site visit" }]);
    expect(defs.map((d) => d.key)).toEqual(["obj:site_visit.read", "obj:site_visit.write", "obj:site_visit.delete"]);
    expect(defs.every((d) => isObjectPermission(d.key) && d.resource === "obj:site_visit")).toBe(true);
  });
  it("page permission for /o/<key> is the object read permission", () => {
    expect(pagePermission("/o/site_visit")).toBe("obj:site_visit.read");
    expect(pagePermission("/o/site_visit/abc")).toBe("obj:site_visit.read");
  });
});
