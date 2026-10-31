import { describe, expect, it } from "vitest";
import { formatDate, formatInr, formatIstDateTime, isoToIstInput, istInputToIso, normalizePhone, paiseToRupees, parseRupees, rupeesToPaise } from "../format";
import { checkValue, coerceValue, friendlyIssue, validateCustom } from "../validate";
import { PARITY } from "./parity-cases";
import { def, UUID } from "./fixtures";

describe("checkValue parity with metadata.check_value", () => {
  it.each(PARITY.map((c) => [c.name, c] as const))("%s", (_n, c) => {
    expect(checkValue(def({ key: "x", type: c.type, options: c.options, validation: c.validation }), c.value)).toBe(c.error);
  });
});

describe("coerceValue per type", () => {
  it("text trims and empty becomes null", () => {
    expect(coerceValue({ type: "text" }, "  Anna ")).toBe("Anna");
    expect(coerceValue({ type: "text" }, "   ")).toBeNull();
    expect(coerceValue({ type: "number" }, undefined)).toBeNull();
  });
  it("number and percent parse grouped input; junk stays for the validator to reject", () => {
    expect(coerceValue({ type: "number" }, "1,23,456.5")).toBe(123456.5);
    expect(coerceValue({ type: "percent" }, "12")).toBe(12);
    expect(coerceValue({ type: "number" }, "twelve")).toBe("twelve");
    expect(checkValue(def({ key: "n", type: "number" }), coerceValue({ type: "number" }, "twelve"))).toBe("must be a number");
  });
  it("phone becomes E.164 (bare Indian mobiles get +91)", () => {
    expect(coerceValue({ type: "phone" }, "98765 43210")).toBe("+919876543210");
    expect(coerceValue({ type: "phone" }, "09876543210")).toBe("+919876543210");
    expect(coerceValue({ type: "phone" }, "+44 (20) 7946 0958")).toBe("+442079460958");
    expect(coerceValue({ type: "phone" }, "0091 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(checkValue(def({ key: "p", type: "phone" }), coerceValue({ type: "phone" }, "call me"))).toBe("must be a phone number");
  });
  it("email lowercases, url gets https", () => {
    expect(coerceValue({ type: "email" }, " Anna@Example.COM ")).toBe("anna@example.com");
    expect(coerceValue({ type: "url" }, "example.com/pricing")).toBe("https://example.com/pricing");
    expect(coerceValue({ type: "url" }, "http://x.in")).toBe("http://x.in");
  });
  it("boolean from form strings", () => {
    expect(coerceValue({ type: "boolean" }, "yes")).toBe(true);
    expect(coerceValue({ type: "boolean" }, "off")).toBe(false);
  });
  it("multi_select dedupes and splits a comma string", () => {
    expect(coerceValue({ type: "multi_select" }, "a, b,a")).toEqual(["a", "b"]);
    expect(coerceValue({ type: "multi_select" }, ["a", "a"])).toEqual(["a"]);
  });
});

describe("money: INR rupees stored, paise for arithmetic", () => {
  it("parses rupee strings with symbols and Indian grouping", () => {
    expect(parseRupees("₹1,50,000.50")).toBe(150000.5);
    expect(parseRupees("Rs. 2000")).toBe(2000);
    expect(parseRupees("INR 10")).toBe(10);
    expect(parseRupees("ten")).toBeNaN();
    expect(coerceValue({ type: "money" }, "₹99.999")).toBe(100);
  });
  it("paise round trip has no float drift", () => {
    expect(rupeesToPaise(19.99)).toBe(1999);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(paiseToRupees(1999)).toBe(19.99);
  });
  it("stores rupees (the DB rule is a non-negative number) and rejects negatives", () => {
    const d = def({ key: "budget", type: "money" });
    expect(checkValue(d, coerceValue(d, "₹1,50,000"))).toBeNull();
    expect(checkValue(d, coerceValue(d, "-5"))).toBe("must not be negative");
    expect(formatInr(150000.5).replace(/\s/g, " ")).toBe("₹1,50,000.50");
    expect(formatInr(2500000)).toBe("₹25,00,000");
  });
});

describe("dates and IST", () => {
  it("date accepts day-first input and rejects impossible dates", () => {
    const d = def({ key: "d", type: "date" });
    expect(coerceValue(d, "02/11/2026")).toBe("2026-11-02");
    expect(coerceValue(d, "2-11-2026")).toBe("2026-11-02");
    expect(checkValue(d, coerceValue(d, "30/02/2026"))).toBe("is not valid");
    expect(formatDate("2026-11-02")).toBe("02 Nov 2026");
  });
  it("datetime typed in IST is stored as the UTC instant", () => {
    const d = def({ key: "t", type: "datetime" });
    expect(coerceValue(d, "2026-11-02T14:30")).toBe("2026-11-02T09:00:00.000Z");
    expect(coerceValue(d, "2026-11-02T00:15")).toBe("2026-11-01T18:45:00.000Z");
    expect(istInputToIso("2026-11-02T25:00")).toBeNull();
    expect(istInputToIso("2026-02-30T10:00")).toBeNull();
    expect(coerceValue(d, "2026-11-02T14:30:00+05:30")).toBe("2026-11-02T09:00:00.000Z");
  });
  it("round trips to the datetime-local value and displays with an IST label", () => {
    expect(isoToIstInput("2026-11-02T09:00:00.000Z")).toBe("2026-11-02T14:30");
    expect(isoToIstInput("2026-11-01T18:45:00.000Z")).toBe("2026-11-02T00:15");
    expect(formatIstDateTime("2026-11-02T09:00:00.000Z")).toBe("02 Nov 2026, 2:30 pm IST");
    expect(formatIstDateTime("2026-11-02T18:35:00.000Z")).toBe("03 Nov 2026, 12:05 am IST");
  });
});

describe("validateCustom (shared with the DB trigger rules)", () => {
  const fields = [
    def({ key: "budget", type: "money", required: true }),
    def({ key: "source", type: "select", options: { choices: [{ key: "web", label: { en: "Web" } }, { key: "old", label: { en: "Old" }, archived: true }] }, default: "web" }),
    def({ key: "old_note", type: "text", archivedAt: "2026-10-01T00:00:00Z" }),
  ];

  it("required: absent or null fails with the DB message", () => {
    expect(validateCustom(fields, {}, "update").issues).toEqual([{ path: "budget", message: 'custom field "budget" is required' }]);
    expect(validateCustom(fields, { budget: null }, "update").issues[0].message).toBe('custom field "budget" is required');
  });
  it("create fills defaults for absent keys; update does not", () => {
    expect(validateCustom(fields, { budget: "100" }, "create").value).toEqual({ budget: 100, source: "web" });
    expect(validateCustom(fields, { budget: "100" }, "update").value).toEqual({ budget: 100 });
  });
  it("unknown keys are rejected with the DB message", () => {
    expect(validateCustom(fields, { budget: 1, nope: 1 }, "update").issues).toEqual([{ path: "nope", message: 'unknown custom field "nope"' }]);
  });
  it("type errors use the DB wording", () => {
    expect(validateCustom(fields, { budget: "abc" }, "update").issues[0].message).toBe('custom field "budget" must be a number');
  });
  it("select option retire: stored value stays valid, a new pick is refused", () => {
    expect(validateCustom(fields, { budget: 1, source: "old" }, "update", { existing: { budget: 1, source: "old" } }).issues).toEqual([]);
    expect(validateCustom(fields, { budget: 1, source: "old" }, "update", { existing: { budget: 1, source: "web" } }).issues[0].message).toBe('custom field "source" is not one of the listed choices');
    expect(validateCustom(fields, { budget: 1, source: "old" }, "create").issues).toHaveLength(1);
  });
  it("multi_select retired choice follows the same rule", () => {
    const m = def({ key: "tags", type: "multi_select", options: { choices: [{ key: "a", label: { en: "A" } }, { key: "b", label: { en: "B" }, archived: true }] } });
    expect(validateCustom([m], { tags: ["a", "b"] }, "update", { existing: { tags: ["b"] } }).issues).toEqual([]);
    expect(validateCustom([m], { tags: ["a", "b"] }, "update", { existing: { tags: ["a"] } }).issues[0].message).toContain("not a listed choice");
  });
  it("retired field: unchanged stored value is kept, new value refused", () => {
    expect(validateCustom(fields, { budget: 1, old_note: "keep" }, "update", { existing: { old_note: "keep" } })).toEqual({ value: { budget: 1, old_note: "keep" }, issues: [] });
    expect(validateCustom(fields, { budget: 1, old_note: "new" }, "update", { existing: { old_note: "keep" } }).issues[0].message).toBe('unknown custom field "old_note"');
  });
  it("coerces before checking (phone to E.164, IST datetime to UTC)", () => {
    const f = [def({ key: "mobile", type: "phone" }), def({ key: "demo_at", type: "datetime" })];
    expect(validateCustom(f, { mobile: "98765 43210", demo_at: "2026-11-02T14:30" }, "update").value).toEqual({ mobile: "+919876543210", demo_at: "2026-11-02T09:00:00.000Z" });
  });
  it("user and lookup need ids", () => {
    const f = [def({ key: "owner2", type: "user" })];
    expect(validateCustom(f, { owner2: UUID }, "update").issues).toEqual([]);
    expect(validateCustom(f, { owner2: "me" }, "update").issues[0].message).toBe('custom field "owner2" must be a record id');
  });
  it("friendlyIssue swaps the key for the label", () => {
    const f = def({ key: "budget", type: "money", label: { en: "Budget", ta: "பட்ஜெட்" } });
    const i = validateCustom([f], { budget: "x" }, "update").issues[0];
    expect(friendlyIssue(f, i)).toBe("Budget must be a number");
    expect(friendlyIssue(f, i, "ta")).toBe("பட்ஜெட் must be a number");
  });
});
