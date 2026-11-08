// Error report CSV: every row that was not imported because of a problem, with the original cells and a plain reason.
import { BASE } from "@/i18n/registry";
import { toCsv } from "./csv-guard";
import { MAX_ERROR_ROWS } from "./limits";
import type { ParsedRow, PlannedRow } from "./types";

type Reasons = Record<string, string>;
const reasonsEn = (): Reasons => ((BASE.en.imports as { reasons?: Reasons } | undefined)?.reasons ?? {});

export interface ReportLabels { row: string; field: string; code: string; reason: string }
const DEFAULT_LABELS: ReportLabels = { row: "row", field: "field", code: "reason_code", reason: "reason" };

/**
 * Rows that were invalid, duplicated inside the file, or failed to write. One CSV line per problem (a row with two problems
 * appears twice), so a spreadsheet filter by `reason_code` works. Capped at MAX_ERROR_ROWS lines.
 */
export function buildErrorReport(headers: string[], source: ParsedRow[], planned: PlannedRow[], labels: ReportLabels = DEFAULT_LABELS, reasons: Reasons = reasonsEn()): { csv: string; lines: number } {
  const byNo = new Map(source.map((r) => [r.rowNo, r]));
  const out: unknown[][] = [];
  for (const p of planned) {
    if (p.status === "new" || (p.status === "duplicate" && p.issues.length === 0)) continue;
    const src = byNo.get(p.rowNo);
    for (const i of p.issues) {
      if (out.length >= MAX_ERROR_ROWS) break;
      out.push([p.rowNo, ...headers.map((h) => src?.cells[h] ?? ""), i.field, i.reason, reasons[i.reason] ?? i.reason]);
    }
  }
  return { csv: toCsv([labels.row, ...headers, labels.field, labels.code, labels.reason], out, { bom: true }), lines: out.length };
}
