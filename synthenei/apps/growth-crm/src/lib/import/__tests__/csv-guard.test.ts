// @vitest-environment node
import { describe, expect, it } from "vitest";
import { csvEscape, guardCell, toCsv } from "../csv-guard";

describe("guardCell (formula injection)", () => {
  it.each(["=SUM(A1:A9)", "+91 98765 43210", "-2+3", "@cmd", "\tcmd", "\rcmd", "  =1+1", "＝1+1"])("prefixes %j", (v) => expect(guardCell(v)).toBe(`'${v}`));
  it.each(["hello", "Asha = good", "a+b", "100", "", "x@y.com"])("leaves %j alone", (v) => expect(guardCell(v)).toBe(v));
  it("does not touch real numbers or empties", () => {
    expect(guardCell(-5)).toBe("-5");
    expect(guardCell(null)).toBe("");
    expect(guardCell(undefined)).toBe("");
  });
});

describe("toCsv", () => {
  it("escapes commas, quotes and newlines, and guards every cell", () => {
    const out = toCsv(["a", "b"], [["x,y", '"q"'], ["=cmd|' /C calc'!A0", "line1\nline2"]]);
    expect(out).toBe(`a,b\r\n"x,y","""q"""\r\n'=cmd|' /C calc'!A0,"line1\nline2"\r\n`);
  });
  it("guards header cells too", () => expect(toCsv(["=evil"], [])).toBe("'=evil\r\n"));
  it("adds a BOM only when asked", () => {
    expect(toCsv(["a"], [], { bom: true }).charCodeAt(0)).toBe(0xfeff);
    expect(toCsv(["a"], []).charCodeAt(0)).toBe(97);
  });
  it("csvEscape leaves plain text", () => expect(csvEscape("plain")).toBe("plain"));
});
