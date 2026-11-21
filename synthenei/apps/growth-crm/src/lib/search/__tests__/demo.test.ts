import { describe, expect, it } from "vitest";
import { searchDemo, type DemoInput } from "../demo";

const base: DemoInput = {
  q: "", pii: true, ownOnly: null,
  leads: [{ id: "l1", name: "Karthik Raja", title: "Partner", accountId: "a1", ownerId: "me" }, { id: "l2", name: "Meena Sundar", title: "Associate", accountId: "a1", ownerId: "other" }],
  accounts: [{ id: "a1", name: "Vaigai Advocates", city: "Madurai", district: "Madurai" }],
  records: { rows: [{ id: "r1", title: "Example: first item", data: { name: "Example: first item", contact_phone: "+919800000001", notes: "ledger" }, objectKey: "example_items", label: "Example item" }], searchableKeys: ["name", "contact_phone"], piiKeys: ["contact_phone"] },
};
const run = (o: Partial<DemoInput>) => searchDemo({ ...base, ...o });

describe("demo search", () => {
  it("finds leads, accounts and records", () => {
    expect(run({ q: "karthik" }).map((h) => h.key)).toEqual(["lead:l1"]);
    expect(run({ q: "vaigai" }).map((h) => h.type)).toContain("account");
    expect(run({ q: "first item" })[0]).toMatchObject({ type: "record", href: "/o/example_items/r1" });
  });
  it("viewers see initials and cannot find a lead by the hidden full name", () => {
    expect(run({ q: "karthik", pii: false }).filter((h) => h.type === "lead")).toEqual([]);
    const h = run({ q: "k. r", pii: false }).find((x) => x.type === "lead");
    expect(h).toMatchObject({ title: "K. R.", masked: true });
  });
  it("a masked viewer still finds leads by firm", () => {
    expect(run({ q: "vaigai", pii: false }).filter((h) => h.type === "lead").map((h) => h.title)).toEqual(["K. R.", "M. S."]);
  });
  it("PII custom fields are not searchable without pii.read", () => {
    expect(run({ q: "9198000", pii: true }).some((h) => h.type === "record")).toBe(true);
    expect(run({ q: "9198000", pii: false }).some((h) => h.type === "record")).toBe(false);
  });
  it("reps only see their own leads", () => {
    expect(run({ q: "a", ownOnly: { uid: "me" } }).filter((h) => h.type === "lead").map((h) => h.key)).toEqual(["lead:l1"]);
  });
  it("sources the viewer may not read are not searched", () => {
    expect(run({ q: "vaigai", leads: null, accounts: null, records: null })).toEqual([]);
  });
});
