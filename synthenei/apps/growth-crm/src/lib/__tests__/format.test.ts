import { describe, expect, it } from "vitest";
import { NO_DATA, deltaOf, fmtDate, fmtDateY, fmtFor, fmtMonthYear, fmtTime, formatters, inr, inrCompact, isNum, median, minsToHuman, num, numCompact, pct, ratio, relTime, secsToHuman } from "@/lib/format";
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

describe("AUD-125 money: sign, rounding at unit boundaries, Indian grouping", () => {
  it("sign goes before the rupee symbol", () => {
    expect(inr(-1234567)).toBe("-₹12,34,567");
    expect(inrCompact(-250000)).toBe("-₹2.5L");
    expect(inr(-0.4)).toBe("₹0");
    expect(inrCompact(-0.2)).toBe("₹0");
  });
  it("rounds first, then picks the unit (no 100K / 100L)", () => {
    expect(inrCompact(99999.6)).toBe("₹1L");
    expect(inrCompact(99995)).toBe("₹1L");
    expect(inrCompact(99949)).toBe("₹99.9K");
    expect(inrCompact(9999999)).toBe("₹1Cr");
    expect(inrCompact(9_995_000)).toBe("₹1Cr");
    expect(inrCompact(9_949_999)).toBe("₹99.5L");
    expect(inrCompact(999.6)).toBe("₹1K");
    expect(inrCompact(999.4)).toBe("₹999");
    expect(inrCompact(1000)).toBe("₹1K");
    expect(inrCompact(100000)).toBe("₹1L");
    expect(inrCompact(10000000)).toBe("₹1Cr");
    expect(numCompact(99999.6)).toBe("1L");
  });
  it("huge values keep Indian grouping on the crore unit", () => {
    expect(inrCompact(1e12)).toBe("₹1,00,000Cr");
    expect(inr(1e12)).toBe("₹10,00,00,00,00,000");
  });
  it("0 and fractional rupees", () => {
    expect(inr(0)).toBe("₹0"); expect(inrCompact(0)).toBe("₹0"); expect(inr(1234.5)).toBe("₹1,235"); expect(num(-1234567)).toBe("-12,34,567");
  });
  it("percent: sign, digits, no negative zero", () => {
    expect(pct(-0.05, 1)).toBe("-5.0%"); expect(pct(-0.0001, 0)).toBe("0%"); expect(pct(1.5, 0)).toBe("150%"); expect(pct(NaN)).toBe(NO_DATA);
  });
});

describe("AUD-125 Tamil locale", () => {
  const ta = formatters("ta");
  it("uses Indian grouping, rupee symbol and sign first", () => {
    expect(ta.inr(1234567)).toBe("₹12,34,567"); expect(ta.inr(-1234567)).toBe("-₹12,34,567"); expect(ta.number(100000)).toBe("1,00,000");
  });
  it("compact units are Tamil words with the same rounding rule", () => {
    expect(ta.inrCompact(420000)).toBe("₹4.2 லட்சம்"); expect(ta.inrCompact(13000000)).toBe("₹1.3 கோடி"); expect(ta.inrCompact(8400)).toBe("₹8.4 ஆயிரம்");
    expect(ta.inrCompact(99999.6)).toBe("₹1 லட்சம்"); expect(ta.inrCompact(9999999)).toBe("₹1 கோடி");
  });
  it("missing readings still print the marker", () => { for (const v of [null, undefined, NaN, Infinity]) { expect(ta.inr(v)).toBe(NO_DATA); expect(ta.inrCompact(v)).toBe(NO_DATA); expect(ta.percent(v)).toBe(NO_DATA); } });
  it("dates use Tamil month names in IST, English stays English", () => {
    const iso = "2026-11-26T18:30:00Z"; // 27 Nov 2026, 00:00 IST
    expect(fmtFor("en").date(iso)).toBe("27 Nov 2026");
    expect(ta.date(iso)).toMatch(/27/); expect(ta.date(iso)).toMatch(/நவ/); expect(ta.date(iso)).not.toMatch(/Nov/);
    expect(ta.monthYear(iso)).toMatch(/நவம்பர்/);
    expect(fmtFor("en").monthYear("2026-11-01T12:00:00Z")).toBe("November 2026");
  });
  it("time: English is lowercase am/pm, Tamil follows ICU (IST wall clock)", () => {
    expect(fmtTime("2026-11-26T09:30:00Z")).toBe("3:00 pm"); expect(fmtTime("2026-11-26T09:30:00Z", "ta")).toMatch(/3:00/);
  });
  it("relative time in Tamil comes from Intl, English keeps the short form", () => {
    expect(relTime("2026-01-01T00:00:00Z", "2026-01-01T03:00:00Z", "en")).toBe("3h ago");
    const t = relTime("2026-01-01T00:00:00Z", "2026-01-01T03:00:00Z", "ta"); expect(t).not.toMatch(/ago/); expect(t).toMatch(/3/);
    expect(relTime("garbage", "2026-01-01T00:00:00Z", "ta")).toBe(NO_DATA);
  });
  it("invalid dates give the marker, never throw or 'Invalid Date'", () => {
    expect(fmtDate("nope")).toBe(NO_DATA); expect(fmtDateY("nope", "ta")).toBe(NO_DATA); expect(fmtMonthYear("nope")).toBe(NO_DATA); expect(fmtFor("ta").dateTime("x")).toBe(NO_DATA);
  });
  it("collator sorts without depending on the runtime default locale", () => {
    expect(["b", "a", "C"].sort(fmtFor("en").collator.compare)).toEqual(["a", "b", "C"]);
  });
});
