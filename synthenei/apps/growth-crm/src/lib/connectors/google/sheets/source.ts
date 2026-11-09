// Pure helpers for the Sheets import: spreadsheet id from a pasted link, range check, cell matrix -> the T034 ParsedSheet, saved
// configuration, and the column mapping taken from the tenant's field map (the field-mapping editor writes rows of object "Row":
// externalField = column header, localTable/localColumn = the CRM target).
import { MAX_COLUMNS, MAX_ROWS } from "@/lib/import/limits";
import { ImportError, normaliseHeaders } from "@/lib/import/parse";
import { TABLE_OF } from "@/lib/import/targets";
import { isImportObject, type DupMode, type ImportObject, type Mapping, type ParsedRow, type ParsedSheet } from "@/lib/import/types";
import type { FieldMapSpec } from "../../core/types";
import { A1_RANGE, MAX_RANGE_LEN, SHEET_OBJECT, SPREADSHEET_ID } from "./constants";

/** Accepts the bare id or any docs.google.com/spreadsheets/d/<id>/... link. Anything else is null. */
export function parseSpreadsheetId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s || s.length > 500) return null;
  const m = /^https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/.exec(s);
  const id = m ? m[1] : s;
  return SPREADSHEET_ID.test(id) ? id : null;
}
export const isValidRange = (r: string): boolean => typeof r === "string" && r.length <= MAX_RANGE_LEN && A1_RANGE.test(r);

/**
 * Sheet cells -> ParsedSheet (same shape and limits as a CSV upload). The first non-blank row is the header; row numbers are sheet-relative
 * (header = row 1) like the CSV importer so error reports line up. Throws ImportError (empty, too_many_rows, too_many_columns).
 */
export function matrixToSheet(matrix: string[][], maxRows = MAX_ROWS): ParsedSheet {
  const blank = (r: string[]) => r.every((c) => (c ?? "").trim() === "");
  let h = 0;
  while (h < matrix.length && blank(matrix[h])) h++;
  if (h >= matrix.length) throw new ImportError("empty");
  const width = Math.max(...matrix.slice(h).map((r) => r.length));
  const headerRow = Array.from({ length: width }, (_, i) => matrix[h][i] ?? "");
  const headers = normaliseHeaders(headerRow);
  if (headers.length > MAX_COLUMNS) throw new ImportError("too_many_columns");
  const rows: ParsedRow[] = [];
  let blankRows = 0;
  for (let i = h + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (blank(r)) { blankRows++; continue; }
    if (rows.length >= maxRows) throw new ImportError("too_many_rows");
    const cells: Record<string, string> = {};
    headers.forEach((k, j) => { cells[k] = (r[j] ?? "").trim(); });
    rows.push({ rowNo: i - h + 1, cells });
  }
  if (!rows.length) throw new ImportError("empty");
  return { headers, rows, blankRows };
}

/** What the owner saved for this connection. `nonce` changes on every "Import now": the stream runs once per nonce. */
export interface SheetConfig { spreadsheetId: string; range: string; object: ImportObject; mode: DupMode; mapping: Mapping; resync: boolean; nonce: string }

export function parseSheetConfig(raw: string | undefined | null): SheetConfig | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.spreadsheetId !== "string" || !SPREADSHEET_ID.test(o.spreadsheetId) || typeof o.range !== "string" || !isValidRange(o.range)) return null;
  if (typeof o.object !== "string" || !isImportObject(o.object) || (o.mode !== "skip" && o.mode !== "merge") || typeof o.nonce !== "string" || !o.nonce) return null;
  const mapping: Mapping = {};
  if (o.mapping && typeof o.mapping === "object" && !Array.isArray(o.mapping)) for (const [k, t] of Object.entries(o.mapping as Record<string, unknown>)) if (typeof t === "string") mapping[k] = t;
  return { spreadsheetId: o.spreadsheetId, range: o.range, object: o.object, mode: o.mode, mapping, resync: o.resync === true, nonce: o.nonce };
}
export const serializeSheetConfig = (c: SheetConfig): string => JSON.stringify(c);

/** Mapping from the tenant's saved field map for this object (header matched case-insensitively). Headers without a row stay unmapped. */
export function mappingFromFieldMap(specs: FieldMapSpec[], object: ImportObject, headers: string[]): Mapping {
  const byHeader = new Map(headers.map((h) => [h.trim().toLowerCase(), h]));
  const out: Mapping = {};
  for (const s of specs) {
    if (s.externalObject !== SHEET_OBJECT || s.localTable !== TABLE_OF[object] || s.direction === "out") continue;
    const h = byHeader.get(s.externalField.trim().toLowerCase());
    if (h && s.localColumn) out[h] = s.localColumn;
  }
  for (const h of headers) if (!(h in out)) out[h] = "";
  return out;
}
export const hasMapping = (m: Mapping): boolean => Object.values(m).some(Boolean);
