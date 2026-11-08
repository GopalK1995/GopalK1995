// @vitest-environment node
import { describe, expect, it } from "vitest";
import { indexRow, nameCityKey } from "../dedupe";
import { SAMPLE_CSV, demoExisting } from "../demo";
import { buildExportCsv, maskValue } from "../export";
import { parseCsvText, normaliseHeaders, cellText, ImportError } from "../parse";
import { planImport } from "../plan";
import { buildErrorReport } from "../report";
import { importPath, pathBelongsTo } from "../storage";
import { targetsFor } from "../targets";
import { autoMap } from "../mapper";
import { emptyIndex } from "../types";

const T = "11111111-1111-4111-8111-111111111111", W = "22222222-2222-4222-8222-222222222222", J = "33333333-3333-4333-8333-333333333333";
const lead = targetsFor("lead", (k) => k);
const acct = targetsFor("account", (k) => k);

describe("dedupe", () => {
  it("email, E.164 phone and account name+city decide duplicates; the first of a pair in the file is new", () => {
    const sheet = parseCsvText(SAMPLE_CSV.lead);
    const { rows, summary } = planImport({ object: "lead", rows: sheet.rows, mapping: autoMap(sheet.headers, lead), targets: lead, existing: demoExisting("lead") });
    expect(rows.map((r) => r.status)).toEqual(["new", "duplicate", "new", "invalid", "duplicate", "invalid"]);
    expect(rows[1]).toMatchObject({ dupKey: "email", dupId: "demo-1" });
    expect(rows[4]).toMatchObject({ dupId: null, issues: [{ reason: "duplicate_in_file" }] });
    expect(summary).toEqual({ total: 6, fresh: 2, duplicates: 2, invalid: 2 });
  });
  it("a phone written two ways is the same phone", () => {
    const existing = emptyIndex(); indexRow("lead", { id: "x", phone: "+919876543210" }, existing);
    const sheet = parseCsvText("Name,Mobile\nA,098765 43210\n");
    const r = planImport({ object: "lead", rows: sheet.rows, mapping: autoMap(sheet.headers, lead), targets: lead, existing });
    expect(r.rows[0]).toMatchObject({ status: "duplicate", dupKey: "phone", dupId: "x" });
  });
  it("accounts match on name plus city, ignoring case and spacing", () => {
    expect(nameCityKey("  Menon  Traders ", "COIMBATORE")).toBe(nameCityKey("menon traders", "coimbatore"));
    const sheet = parseCsvText(SAMPLE_CSV.account);
    const r = planImport({ object: "account", rows: sheet.rows, mapping: autoMap(sheet.headers, acct), targets: acct, existing: demoExisting("account") });
    expect(r.rows.map((x) => x.status)).toEqual(["new", "duplicate", "new", "duplicate"]);
    expect(r.rows[3].dupId).toBeNull();
  });
  it("same name in another city is not a duplicate", () => {
    const sheet = parseCsvText("Name,City\nKumar Supplies,Salem\n");
    const r = planImport({ object: "account", rows: sheet.rows, mapping: autoMap(sheet.headers, acct), targets: acct, existing: demoExisting("account") });
    expect(r.rows[0].status).toBe("new");
  });
});

describe("parse", () => {
  it("handles BOM, quotes, blank lines and duplicate headers", () => {
    const s = parseCsvText('﻿Name,Name,Note\n"Asha, M",x,"a\nb"\n\n,,\nRavi,y,z\n');
    expect(s.headers).toEqual(["Name", "Name (2)", "Note"]);
    expect(s.rows.map((r) => r.cells.Name)).toEqual(["Asha, M", "Ravi"]);
    expect(s.rows[0].cells.Note).toBe("a\nb");
    expect(s.blankRows).toBe(2);
  });
  it("rejects empty files", () => expect(() => parseCsvText("a,b\n")).toThrow(ImportError));
  it("fills blank header names", () => expect(normaliseHeaders(["", "A", "a"])).toEqual(["Column 1", "A", "a (2)"]));
  it("exceljs cell values", () => {
    expect(cellText({ richText: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(cellText({ formula: "A1", result: 4 })).toBe("4");
    expect(cellText(new Date(Date.UTC(2026, 10, 5)))).toBe("2026-11-05");
    expect(cellText({ text: "site", hyperlink: "https://x.y" })).toBe("site");
    expect(cellText(null)).toBe("");
  });
});

describe("error report and export", () => {
  it("lists only problem rows with original cells and a reason, guarded against formulas", () => {
    const sheet = parseCsvText("Name,Mobile\n=EVIL(),123\nAsha,9876543210\n");
    const { rows } = planImport({ object: "lead", rows: sheet.rows, mapping: autoMap(sheet.headers, lead), targets: lead, existing: emptyIndex() });
    const rep = buildErrorReport(sheet.headers, sheet.rows, rows);
    expect(rep.lines).toBe(1);
    expect(rep.csv).toContain("'=EVIL()");
    expect(rep.csv).toContain("phone_invalid");
    expect(rep.csv).not.toContain("Asha");
  });
  it("masks personal columns only when asked", () => {
    const cols = [{ key: "full_name", label: "Name" }, { key: "email", label: "Email", isPii: true }, { key: "phone", label: "Phone", isPii: true }];
    const rows = [{ full_name: "Asha", email: "asha@example.com", phone: "+919876543210" }];
    expect(buildExportCsv(cols, rows, { maskPii: true })).toContain("a•••@example.com");
    expect(buildExportCsv(cols, rows, { maskPii: true })).not.toContain("9876543210");
    expect(buildExportCsv(cols, rows, { maskPii: false })).toContain("asha@example.com");
    expect(maskValue("phone", "+919876543210")).toBe("+91•••••••10");
  });
  it("export is formula-safe", () => {
    expect(buildExportCsv([{ key: "full_name", label: "Name" }], [{ full_name: "=HYPERLINK(\"x\")" }], { maskPii: false })).toContain("'=HYPERLINK");
  });
});

describe("storage paths", () => {
  it("builds tenant/workspace/job paths and refuses traversal", () => {
    expect(importPath(T, W, J, "../../My leads (1).csv")).toBe(`${T}/${W}/${J}/My_leads__1_.csv`);
    expect(pathBelongsTo(`${T}/${W}/${J}/a.csv`, T, W)).toBe(true);
    expect(pathBelongsTo(`${T}/${W}/${J}/a.csv`, T, "44444444-4444-4444-8444-444444444444")).toBe(false);
    expect(pathBelongsTo(`${T}/${W}/${J}/../x.csv`, T, W)).toBe(false);
    expect(pathBelongsTo(null, T, W)).toBe(false);
    expect(() => importPath("x", W, J, "a.csv")).toThrow();
  });
});
