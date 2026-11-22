import { describe, expect, it } from "vitest";
import { computeTax, fmtInr, placeOfSupply, rupeesToPaise, stateCodeOf } from "../gst";

const TN_GSTIN = "33AAAAA0000A1Z5"; // state code 33

describe("computeTax", () => {
  it("splits into CGST+SGST for an intra-state supply", () => {
    const t = computeTax(100000, 18, TN_GSTIN, "33");
    expect(t).toMatchObject({ kind: "intra", rateBps: 1800, total: 18000, cgst: 9000, sgst: 9000, igst: 0 });
  });
  it("charges IGST for an inter-state supply or an unknown place of supply", () => {
    expect(computeTax(100000, 18, TN_GSTIN, "29")).toMatchObject({ kind: "inter", total: 18000, cgst: 0, sgst: 0, igst: 18000 });
    expect(computeTax(100000, 18, TN_GSTIN, null)).toMatchObject({ kind: "inter", igst: 18000 });
  });
  it("splits an odd total with the extra paise on SGST, keeping cgst+sgst = total", () => {
    const odd = computeTax(339, 18, TN_GSTIN, "33"); // total = round(339*0.18) = 61, an odd paise amount
    expect(odd).toMatchObject({ total: 61, cgst: 30, sgst: 31 });
    expect(odd.cgst + odd.sgst).toBe(odd.total);
  });
  it("rejects a non-integer or negative taxable amount", () => {
    expect(() => computeTax(10.5, 18, TN_GSTIN, "33")).toThrow();
    expect(() => computeTax(-1, 18, TN_GSTIN, "33")).toThrow();
  });
});

describe("stateCodeOf / placeOfSupply", () => {
  it("reads the first two digits of a GSTIN", () => {
    expect(stateCodeOf(TN_GSTIN)).toBe("33");
    expect(stateCodeOf(null)).toBeNull();
    expect(stateCodeOf("not-a-gstin")).toBeNull();
  });
  it("prefers the buyer's GSTIN state over the billing address state code", () => {
    expect(placeOfSupply(TN_GSTIN, "29")).toBe("33");
    expect(placeOfSupply(null, "29")).toBe("29");
    expect(placeOfSupply(null, null)).toBeNull();
    expect(placeOfSupply(null, "bad")).toBeNull();
  });
});

describe("fmtInr", () => {
  it("groups Indian-style with two decimals", () => {
    expect(fmtInr(123456700)).toBe("12,34,567.00");
    expect(fmtInr(50)).toBe("0.50");
    expect(fmtInr(0)).toBe("0.00");
    expect(fmtInr(-123450)).toBe("-1,234.50");
  });
});

describe("rupeesToPaise", () => {
  it("parses whole and decimal rupee amounts exactly", () => {
    expect(rupeesToPaise("1234.50")).toBe(123450);
    expect(rupeesToPaise("19")).toBe(1900);
    expect(rupeesToPaise("0.1")).toBe(10);
  });
  it("rejects more than two decimals or garbage", () => {
    expect(rupeesToPaise("1.234")).toBeNull();
    expect(rupeesToPaise("abc")).toBeNull();
    expect(rupeesToPaise("-5")).toBeNull();
  });
});
