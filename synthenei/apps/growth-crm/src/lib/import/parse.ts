// CSV and XLSX parsing (papaparse, exceljs). Runs in the import job and in the server actions that inspect an upload.
// Output is always strings: typing and validation belong to the mapper.
import Papa from "papaparse";
import { MAX_COLUMNS, MAX_FILE_BYTES, MAX_ROWS } from "./limits";
import type { ParsedRow, ParsedSheet } from "./types";

export type ImportErrorCode = "too_big" | "too_many_rows" | "too_many_columns" | "empty" | "unsupported" | "unreadable";
export class ImportError extends Error {
  constructor(public code: ImportErrorCode, message?: string) { super(message ?? code); this.name = "ImportError"; }
}

export const fileKind = (name: string): "csv" | "xlsx" | null => {
  const n = name.toLowerCase();
  return n.endsWith(".csv") ? "csv" : n.endsWith(".xlsx") ? "xlsx" : null;
};

/** Trim, fill blanks ("Column 3") and de-duplicate ("Phone (2)") header names. */
export function normaliseHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = (h ?? "").replace(/^﻿/, "").trim() || `Column ${i + 1}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

function build(matrix: string[][], maxRows: number): ParsedSheet {
  let h = 0;
  while (h < matrix.length && matrix[h].every((c) => c.trim() === "")) h++;
  if (h >= matrix.length) throw new ImportError("empty");
  const headers = normaliseHeaders(matrix[h]);
  if (headers.length > MAX_COLUMNS) throw new ImportError("too_many_columns");
  const rows: ParsedRow[] = [];
  let blankRows = 0;
  for (let i = h + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (r.every((c) => c.trim() === "")) { blankRows++; continue; }
    if (rows.length >= maxRows) throw new ImportError("too_many_rows");
    const cells: Record<string, string> = {};
    headers.forEach((k, j) => { cells[k] = (r[j] ?? "").trim(); });
    rows.push({ rowNo: i - h + 1, cells }); // the header line is row 1
  }
  if (!rows.length) throw new ImportError("empty");
  return { headers, rows, blankRows };
}

export function parseCsvText(text: string, maxRows = MAX_ROWS): ParsedSheet {
  if (text.length > MAX_FILE_BYTES * 2) throw new ImportError("too_big");
  const r = Papa.parse<string[]>(text.replace(/^﻿/, ""), { header: false, skipEmptyLines: false, delimitersToGuess: [",", ";", "\t", "|"] });
  const fatal = r.errors.find((e) => e.type === "Quotes");
  if (fatal) throw new ImportError("unreadable", fatal.message);
  return build(r.data.map((row) => row.map((c) => (c ?? "").toString())), maxRows);
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

/** One exceljs cell value -> display string. Formulas give their result, rich text its plain text, dates ISO (date only at midnight UTC). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.getUTCHours() + v.getUTCMinutes() + v.getUTCSeconds() === 0 ? isoDate(v) : v.toISOString();
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    if ("result" in o) return cellText(o.result);
    if (typeof o.text === "string") return o.text;
    if (typeof o.hyperlink === "string") return o.hyperlink;
    if (typeof o.error === "string") return "";
  }
  return String(v);
}

export async function parseXlsx(buf: ArrayBuffer | Uint8Array, maxRows = MAX_ROWS): Promise<ParsedSheet> {
  if (buf.byteLength > MAX_FILE_BYTES) throw new ImportError("too_big");
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { throw new ImportError("unreadable"); }
  const ws = wb.worksheets.find((s) => s.actualRowCount > 0);
  if (!ws) throw new ImportError("empty");
  if (ws.actualRowCount > maxRows + 50) throw new ImportError("too_many_rows");
  const cols = Math.min(ws.actualColumnCount, MAX_COLUMNS + 1);
  const matrix: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const out: string[] = [];
    for (let c = 1; c <= cols; c++) out.push(cellText(row.getCell(c).value));
    matrix.push(out);
  });
  return build(matrix, maxRows);
}

export async function parseFile(buf: ArrayBuffer | Uint8Array, filename: string, maxRows = MAX_ROWS): Promise<ParsedSheet> {
  const kind = fileKind(filename);
  if (!kind) throw new ImportError("unsupported");
  if (buf.byteLength > MAX_FILE_BYTES) throw new ImportError("too_big");
  if (kind === "xlsx") return parseXlsx(buf, maxRows);
  return parseCsvText(new TextDecoder("utf-8").decode(buf), maxRows);
}
