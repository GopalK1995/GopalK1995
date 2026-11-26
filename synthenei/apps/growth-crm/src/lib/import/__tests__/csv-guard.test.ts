// @vitest-environment node
import { describe, expect, it } from "vitest";
import { csvCell, csvEscape, csvLine, guardCell, toCsv } from "../csv-guard";

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

describe("csvCell / csvLine (shared by every exporter)", () => {
  it("neutralises each formula prefix before quoting", () => {
    for (const p of ["=", "+", "-", "@", "\t", "\r"]) expect(csvCell(`${p}1+1`).replace(/^"/, "")).toMatch(/^'/);
    expect(csvCell("=1,2")).toBe(`"'=1,2"`);
  });
  it("keeps unicode, quotes and newlines intact", () => {
    expect(csvCell("நன்றி ✓ 日本")).toBe("நன்றி ✓ 日本");
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });
  it("handles long values and a whole line", () => {
    const long = "=" + "x".repeat(50_000);
    expect(csvCell(long)).toBe(`'${long}`);
    expect(csvLine(["a", null, 3, "=x", "b,c"])).toBe(`a,,3,'=x,"b,c"`);
  });
});

describe("every real exporter neutralises formulas", () => {
  const evil = "=HYPERLINK(\"http://x\")";
  it("leads export", async () => {
    const { buildCsv } = await import("@/app/(app)/leads/_lib/persist");
    const out = buildCsv([{ id: "L1", fullName: evil, roleTitle: "+1", firmName: "-2", city: "@c", status: "new", score: 1, ownerId: null, source: "x", phone: "", email: "", createdAt: "", lastTouchAt: "" } as never], { maskPersonal: false, ownerNames: {} });
    expect(out).not.toMatch(/(^|,)"?=HYPERLINK/m);
    expect(out).toContain(`'+1`);
  });
  it("accounts and contacts export", async () => {
    const { accountsCsv, contactsCsv } = await import("@/app/(app)/accounts/_lib/persist");
    expect(accountsCsv([{ id: "A", name: evil, city: "=c", district: "d", customerStatus: "x", ownerId: null, website: "@w", createdAt: "" } as never], {})).not.toMatch(/(^|,)"?=/m);
    expect(contactsCsv([{ id: "C", fullName: evil, roleTitle: "=r", accountId: null, isDecisionMaker: false, phone: "+9", email: "", createdAt: "" } as never], { mask: false, accountNames: {} })).not.toMatch(/(^|,)"?=/m);
  });
  it("segment export and audit export", async () => {
    const { toCsv: seg } = await import("@/lib/segments/persist");
    expect(seg(["n"], [[evil]])).toContain(`'=HYPERLINK`);
    const { csvCell: audit } = await import("@/lib/audit/query");
    expect(audit("@SUM(1)")).toBe("'@SUM(1)");
  });
});
