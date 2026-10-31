import { describe, expect, it } from "vitest";
import { can, systemPrincipal } from "@/lib/authz";
import type { Role } from "@/lib/data/types";
import { deniedEdits, fieldPerm, maskCustomValues, visibleFields } from "../access";
import { listFieldsFor } from "../list";
import { bySection, prepareCustomFields } from "../runtime";
import { def } from "./fixtures";

const P = (role: Role) => systemPrincipal({ uid: `u-${role}`, workspaceId: "ws1", role });
const O = { objectKey: "lead", canWriteRecord: true };
const SECRET = "+919812345678";

const fields = [
  def({ key: "region", type: "text" }),
  def({ key: "mobile", type: "phone", isPii: true }),
  def({ key: "margin", type: "number", options: { access: { viewRoles: ["owner", "sales_manager"] } } }),
  def({ key: "discount", type: "percent", options: { access: { editRoles: ["owner"] } } }),
  def({ key: "gated", type: "text", editablePerm: "leads.assign" }),
  def({ key: "gone", type: "text", archivedAt: "2026-10-01T00:00:00Z" }),
];
const values = { region: "south", mobile: SECRET, margin: 31, discount: 5, gated: "g", gone: "kept" };

describe("field mask by role", () => {
  it("fixture sanity: owner holds pii.read, viewer does not", () => {
    expect(can(P("owner"), "pii.read")).toBe(true);
    expect(can(P("viewer"), "pii.read")).toBe(false);
  });

  it("PII field value is absent from the serialised props of a viewer without pii.read", () => {
    const prepared = prepareCustomFields({ defs: fields, values, principal: P("viewer"), objectKey: "lead", canWriteRecord: false });
    const json = JSON.stringify(prepared);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain('"mobile"');
    expect(prepared.fields.map((f) => f.key)).not.toContain("mobile");
    expect(prepared.values).not.toHaveProperty("mobile");
    expect(prepared.hiddenCount).toBeGreaterThan(0);
  });

  it("role-restricted view: value and definition are absent for other roles, present for allowed ones", () => {
    const rep = JSON.stringify(prepareCustomFields({ defs: fields, values, principal: P("sales_rep"), objectKey: "lead", canWriteRecord: true }));
    expect(rep).not.toContain('"margin"');
    expect(rep).not.toContain('"margin":31');
    const mgr = prepareCustomFields({ defs: fields, values, principal: P("sales_manager"), objectKey: "lead", canWriteRecord: true });
    expect(mgr.values.margin).toBe(31);
  });

  it("access internals (roles, editablePerm) never reach the client", () => {
    const json = JSON.stringify(prepareCustomFields({ defs: fields, values, principal: P("owner"), objectKey: "lead", canWriteRecord: true }));
    expect(json).not.toContain("viewRoles");
    expect(json).not.toContain("editRoles");
    expect(json).not.toContain("editablePerm");
    expect(json).not.toContain("leads.assign");
  });

  it("retired fields are hidden everywhere, and their values are not sent", () => {
    const owner = prepareCustomFields({ defs: fields, values, principal: P("owner"), objectKey: "lead", canWriteRecord: true });
    expect(owner.fields.map((f) => f.key)).not.toContain("gone");
    expect(owner.values).not.toHaveProperty("gone");
  });

  it("owner (fields.manage) sees PII and role-restricted fields", () => {
    const keys = visibleFields(fields, P("owner"), O).map((v) => v.def.key);
    expect(keys).toEqual(expect.arrayContaining(["region", "mobile", "margin", "discount", "gated"]));
  });

  it("read grant fieldMask hides a custom key", () => {
    const p = P("sales_manager");
    p.grants = { ...p.grants, "leads.read": { ...p.grants["leads.read"], fieldMask: ["custom.region"] } };
    expect(visibleFields(fields, p, O).map((v) => v.def.key)).not.toContain("region");
  });

  it("maskCustomValues removes keys, it does not blank them", () => {
    const out = maskCustomValues(fields, values, P("viewer"), { objectKey: "lead", canWriteRecord: false });
    expect(Object.keys(out)).not.toContain("mobile");
    expect(Object.keys(out)).not.toContain("margin");
  });
});

describe("edit permission", () => {
  it("record not writable: nothing is editable", () => {
    expect(fieldPerm(fields[0], P("owner"), { objectKey: "lead", canWriteRecord: false })).toEqual({ view: true, edit: false });
  });
  it("editRoles restricts who may change a visible field", () => {
    expect(fieldPerm(fields[3], P("owner"), O).edit).toBe(true);
    expect(fieldPerm(fields[3], P("sales_manager"), O)).toEqual({ view: true, edit: false });
  });
  it("editablePerm needs that permission", () => {
    const held = can(P("sales_rep"), "leads.assign");
    expect(fieldPerm(fields[4], P("sales_rep"), O).edit).toBe(held);
    expect(fieldPerm(fields[4], P("viewer"), O).edit).toBe(false);
  });
  it("deniedEdits lists keys the caller may not write, including unknown and hidden keys", () => {
    expect(deniedEdits(fields, ["region", "discount", "mobile", "nope", "gone"], P("sales_manager"), O).sort()).toEqual(["discount", "gone", "nope"].sort());
  });
});

describe("list masking", () => {
  it("maskRow strips unseen keys from row.custom before it is serialised", () => {
    const { fields: cols, maskRow } = listFieldsFor(fields, P("viewer"), "lead");
    const row = maskRow({ id: "1", custom: { ...values } });
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(cols.map((c) => c.key)).not.toContain("mobile");
    expect(cols.every((c) => !c.edit)).toBe(true);
  });
});

describe("sections", () => {
  it("groups by section, unsectioned first, keeping order", () => {
    const g = bySection([{ section: "B", k: 1 }, { section: null, k: 2 }, { section: "B", k: 3 }, { section: "A", k: 4 }]);
    expect(g.map((x) => x.section)).toEqual(["", "B", "A"]);
    expect(g[1].fields.map((f) => f.k)).toEqual([1, 3]);
  });
});
