import { describe, expect, it } from "vitest";
import { NO_DATA, deltaOf, formatters, inr, inrCompact, isNum, median, minsToHuman, num, numCompact, pct, ratio, relTime, secsToHuman } from "@/lib/format";
import { FMT } from "@/components/charts/kit";

const BAD: [string, number | null | undefined][] = [["NaN", NaN], ["undefined", undefined], ["null", null], ["Infinity", Infinity], ["-Infinity", -Infinity]];
const noNaN = (s: string) => expect(s).not.toMatch(/NaN|Infinity|undefined|null/);

describe("single-value formatters never print NaN", () => {
  const fns: [string, (n: number | null | undefined) => string][] = [
    ["inr", inr], ["inrCompact", inrCompact], ["num", num], ["numCompact", numCompact], ["pct", (n) => pct(n)], ["minsToHuman", minsToHuman], ["secsToHuman", secsToHuman],
    ["formatters.number", formatters().number], ["formatters.inr", formatters().inr], ["formatters.inr ta", formatters("ta").inr],
    ...Object.entries(FMT).map(([k, f]) => [`FMT.${k}`, f] as [string, (n: number | null | undefined) => string]),
  ];
  for (const [name, f] of fns) {
    for (const [label, v] of BAD) it(`${name}(${label}) is the missing marker`, () => { expect(f(v)).toBe(NO_DATA); noNaN(f(v)); });
    it(`${name}(0), huge and negative are finite text`, () => {
      for (const v of (name === "secsToHuman" ? [0, 5, 1e15, 123456789] : [0, -5, 1e15, 123456789])) { noNaN(f(v)); expect(f(v)).not.toBe(NO_DATA); }
    });
  }
});

describe("values", () => {
  it("inr uses Indian grouping", () => { expect(inr(1234567)).toBe("₹12,34,567"); expect(inr(0)).toBe("₹0"); });
  it("inrCompact", () => { expect(inrCompact(420000)).toBe("₹4.2L"); expect(inrCompact(13000000)).toBe("₹1.3Cr"); expect(inrCompact(8400)).toBe("₹8.4K"); });
  it("numCompact", () => { expect(numCompact(1500)).toBe("1.5K"); expect(numCompact(250000)).toBe("2.5L"); });
  it("pct", () => { expect(pct(0.1234)).toBe("12.3%"); expect(pct(0)).toBe("0.0%"); expect(pct(-0.5, 0)).toBe("-50%"); });
  it("minsToHuman", () => { expect(minsToHuman(5)).toBe("5m"); expect(minsToHuman(90)).toBe("1.5h"); expect(minsToHuman(2880)).toBe("2.0d"); expect(minsToHuman(0)).toBe("0m"); });
  it("secsToHuman", () => { expect(secsToHuman(200)).toBe("3m 20s"); expect(secsToHuman(45)).toBe("45s"); expect(secsToHuman(0)).toBe("0s"); expect(secsToHuman(-3)).toBe(NO_DATA); });
});

describe("ratio, median, relTime, isNum", () => {
  it("ratio is NaN on missing or zero denominators and finite otherwise", () => {
    for (const [, v] of BAD) { expect(ratio(v, 5)).toBeNaN(); expect(ratio(5, v)).toBeNaN(); }
    expect(ratio(5, 0)).toBeNaN(); expect(ratio(5, -1)).toBeNaN(); expect(ratio(0, 5)).toBe(0); expect(ratio(10, 4)).toBe(2.5);
  });
  it("a ratio fed to a formatter shows the marker, not NaN", () => {
    expect(inr(ratio(100, 0))).toBe(NO_DATA); expect(pct(ratio(1, 0))).toBe(NO_DATA); expect(minsToHuman(median([]))).toBe(NO_DATA);
  });
  it("median ignores non-finite entries", () => {
    expect(median([1, 3, NaN, undefined, null])).toBe(2); expect(median([])).toBeNaN(); expect(median([NaN])).toBeNaN(); expect(median([Infinity, 4])).toBe(4);
  });
  it("relTime survives a bad date", () => {
    expect(relTime("garbage", "2026-01-01T00:00:00Z")).toBe(NO_DATA);
    expect(relTime("2026-01-01T00:00:00Z", "2026-01-01T02:00:00Z")).toBe("2h ago");
  });
  it("isNum", () => { expect(isNum(0)).toBe(true); expect(isNum(NaN)).toBe(false); expect(isNum(null)).toBe(false); expect(isNum(Infinity)).toBe(false); });
});

describe("deltaOf", () => {
  it("zero or missing baseline gives no delta", () => {
    expect(deltaOf(0, 0)).toBeNaN(); expect(deltaOf(5, 0)).toBeNaN();
    expect(deltaOf(5, undefined)).toBeNaN(); expect(deltaOf(5, null)).toBeNaN(); expect(deltaOf(NaN, 5)).toBeNaN(); expect(deltaOf(Infinity, 5)).toBeNaN();
  });
  it("a current value of exactly 0 is not reported as a 100% drop", () => { expect(deltaOf(0, 5)).toBeNaN(); });
  it("honours a minimum base", () => { expect(deltaOf(10, 3, 4)).toBeNaN(); expect(deltaOf(10, 5, 4)).toBe(1); });
  it("computes real changes", () => { expect(deltaOf(150, 100)).toBeCloseTo(0.5); expect(deltaOf(50, 100)).toBeCloseTo(-0.5); });
});
