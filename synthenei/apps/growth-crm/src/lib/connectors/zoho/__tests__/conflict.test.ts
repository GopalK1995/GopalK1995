// The conflict-resolution table (integration_field_maps.direction + conflict_owner) and the three-way merge rules. Pure.
import { describe, expect, it } from "vitest";
import { canon, decodeBase, encodeBase, reconcile, resolveConflict, shortHash, type ColumnSpec, type Owner } from "../engine/conflict";

const spec = (direction: ColumnSpec["direction"], owner: Owner = "crm", column = "city"): ColumnSpec => ({ column, externalField: "City", direction, owner, transform: null, transformArg: null });
const base = (l: unknown, r: unknown, column = "city") => ({ l: { [column]: shortHash(l) }, r: { [column]: shortHash(r) } });
const NEW = "2026-11-02T10:00:00Z", OLD = "2026-11-01T10:00:00Z";

describe("resolveConflict: who wins a column changed on both sides", () => {
  // direction, owner, localAt, remoteAt -> winner
  const table: [ColumnSpec["direction"], Owner, string | null, string | null, "local" | "remote"][] = [
    ["both", "crm", OLD, NEW, "local"],
    ["both", "crm", NEW, OLD, "local"],
    ["both", "external", NEW, OLD, "remote"],
    ["both", "external", OLD, NEW, "remote"],
    ["both", "last_write", OLD, NEW, "remote"],
    ["both", "last_write", NEW, OLD, "local"],
    ["both", "last_write", NEW, NEW, "local"],        // tie goes to the CRM
    ["both", "last_write", null, NEW, "local"],       // unknown timestamp goes to the CRM
    ["both", "last_write", OLD, null, "local"],
    ["in", "crm", NEW, OLD, "remote"],                 // inbound-only column: the vendor is the only writer, whatever the owner says
    ["in", "last_write", NEW, OLD, "remote"],
    ["out", "external", OLD, NEW, "local"],            // outbound-only column: the CRM is the only writer
    ["out", "last_write", OLD, NEW, "local"],
  ];
  it.each(table)("direction %s, owner %s, local %s, remote %s -> %s", (d, o, l, r, w) => expect(resolveConflict(o, d, l, r)).toBe(w));
});

describe("reconcile: one column", () => {
  const run = (s: ColumnSpec, local: unknown, remote: unknown, b: ReturnType<typeof base> | null, at: [string | null, string | null] = [OLD, NEW]) =>
    reconcile({ specs: [s], local: { city: local }, remote: { city: remote }, base: b, localAt: at[0], remoteAt: at[1], required: new Set() });

  // [direction, owner, base value, local, remote, expected decision, expected local patch, expected remote patch]
  type Row = [ColumnSpec["direction"], Owner, string, string, string, string | null, string | undefined, string | undefined];
  const rows: Row[] = [
    ["both", "crm", "A", "A", "A", null, undefined, undefined],                 // nothing changed
    ["both", "crm", "A", "A", "B", "pull", "B", undefined],                      // only the vendor changed
    ["both", "crm", "A", "B", "A", "push", undefined, "B"],                      // only the CRM changed
    ["both", "crm", "A", "B", "C", "conflict_local", undefined, "B"],            // both changed, crm owns
    ["both", "external", "A", "B", "C", "conflict_remote", "C", undefined],      // both changed, vendor owns
    ["both", "last_write", "A", "B", "C", "conflict_remote", "C", undefined],    // vendor is newer (OLD vs NEW)
    ["both", "crm", "A", "B", "B", null, undefined, undefined],                  // both changed to the same value: converged
    ["in", "crm", "A", "B", "A", null, undefined, undefined],                    // inbound-only: a CRM edit is never pushed
    ["in", "crm", "A", "A", "B", "pull", "B", undefined],
    ["in", "crm", "A", "B", "C", "conflict_remote", "C", undefined],
    ["out", "crm", "A", "A", "B", null, undefined, undefined],                   // outbound-only: a vendor edit is never pulled
    ["out", "crm", "A", "B", "A", "push", undefined, "B"],
    ["out", "external", "A", "B", "C", "conflict_local", undefined, "B"],
  ];
  it.each(rows)("%s/%s base %s local %s remote %s -> %s", (d, o, b, l, r, decision, lp, rp) => {
    const p = run(spec(d, o), l, r, base(b, b));
    expect(p.decisions.map((x) => x.decision)).toEqual(decision ? [decision] : []);
    expect(p.localPatch.city).toBe(lp);
    expect(p.remotePatch.city).toBe(rp);
  });

  it("first meeting (no base) counts as changed on both sides and the owner decides", () => {
    expect(run(spec("both", "crm"), "L", "R", null).remotePatch).toEqual({ city: "L" });
    expect(run(spec("both", "external"), "L", "R", null).localPatch).toEqual({ city: "R" });
    expect(run(spec("both", "crm"), "same", "same", null).decisions).toEqual([]);
  });

  it("the next base records what each side holds after the patches, so the same run is a no-op the second time", () => {
    const first = run(spec("both", "crm"), "B", "C", base("A", "A"));
    expect(first.next).toEqual({ l: { city: shortHash("B") }, r: { city: shortHash("B") } });
    const second = run(spec("both", "crm"), "B", "B", first.next);
    expect(second.decisions).toEqual([]);
    expect(second.localPatch).toEqual({});
    expect(second.remotePatch).toEqual({});
  });

  it("a column the vendor did not send is unknown: nothing is pulled, pushed or nulled", () => {
    const p = reconcile({ specs: [spec("both")], local: { city: "X" }, remote: {}, base: base("A", "A"), localAt: OLD, remoteAt: NEW, required: new Set() });
    expect(p.localPatch).toEqual({});
    expect(p.remotePatch).toEqual({});
  });

  it("a null is never pulled into or pushed from a required column", () => {
    const req = new Set(["city"]);
    expect(reconcile({ specs: [spec("both")], local: { city: "X" }, remote: { city: null }, base: base("X", "X"), localAt: OLD, remoteAt: NEW, required: req }).localPatch).toEqual({});
    expect(reconcile({ specs: [spec("both")], local: { city: null }, remote: { city: "X" }, base: base("X", "X"), localAt: NEW, remoteAt: OLD, required: req }).remotePatch).toEqual({});
  });

  it("clearing a value on one side travels as a null", () => {
    expect(run(spec("both"), "A", null, base("A", "A")).localPatch).toEqual({ city: null });
    expect(run(spec("both"), null, "A", base("A", "A")).remotePatch).toEqual({ city: null });
  });
});

describe("reconcile: columns are independent (field-level, not record-level)", () => {
  it("a vendor edit to one field and a CRM edit to another both survive, even when the owner is crm", () => {
    const specs = [spec("both", "crm", "city"), spec("both", "crm", "phone")];
    const b = { l: { city: shortHash("A"), phone: shortHash("1") }, r: { city: shortHash("A"), phone: shortHash("1") } };
    const p = reconcile({ specs, local: { city: "A", phone: "2" }, remote: { city: "B", phone: "1" }, base: b, localAt: OLD, remoteAt: NEW, required: new Set() });
    expect(p.localPatch).toEqual({ city: "B" });
    expect(p.remotePatch).toEqual({ phone: "2" });
    expect(p.decisions.map((d) => d.decision).sort()).toEqual(["pull", "push"]);
  });
});

describe("value normal form and base encoding", () => {
  it("compares numbers, numeric strings and padded text across the two sides", () => {
    expect(canon(12000)).toBe(canon("12000.00"));
    expect(canon(" Chennai ")).toBe(canon("Chennai"));
    expect(canon(null)).toBe(canon(undefined));
    expect(canon(null)).not.toBe(canon(""));
  });
  it("round-trips a base, and treats a plain hex hash (generic upserter) as no base", () => {
    const b = base("a", "b");
    expect(decodeBase(encodeBase(b))).toEqual(b);
    expect(decodeBase("9f86d081884c7d659a2feaa0c55ad015")).toBeNull();
    expect(decodeBase(null)).toBeNull();
    expect(decodeBase('{"l":{"a":1},"r":{}}')).toBeNull();
  });
});
