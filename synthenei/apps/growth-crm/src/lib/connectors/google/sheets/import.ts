// Sheets -> the T034 import pipeline: read the range, build a ParsedSheet, map columns, plan (new / duplicate / invalid) with the
// engine's dedupe (email, E.164 phone, account name + city), then write in batches. The port keeps the database out of unit tests;
// the Supabase implementation (import-supabase.ts) wraps loadExistingIndex / writePlan from src/lib/import/engine.ts unchanged.
import type { WriteResult } from "@/lib/import/engine";
import { ImportError } from "@/lib/import/parse";
import { autoMap, checkMapping } from "@/lib/import/mapper";
import { planImport } from "@/lib/import/plan";
import type { DupMode, ExistingIndex, ImportObject, Mapping, ParsedSheet, PlanSummary, PlannedRow, TargetField } from "@/lib/import/types";
import type { ConnectionRow, FieldMapSpec } from "../../core/types";
import type { SheetsGateway } from "./gateway";
import { hasMapping, mappingFromFieldMap, matrixToSheet, type SheetConfig } from "./source";

export interface SheetsImportPort {
  /** System + custom target fields of the object for this tenant (workspace field_defs included). */
  targets(i: { tenantId: string; workspaceId: string; object: ImportObject }): Promise<TargetField[]>;
  loadExisting(workspaceId: string, object: ImportObject): Promise<ExistingIndex>;
  write(rows: PlannedRow[], o: { workspaceId: string; tenantId: string; object: ImportObject; mode: DupMode; source: string }): Promise<WriteResult>;
}

export type SheetImportFail = "empty" | "too_many_rows" | "too_many_columns" | "unreadable" | "mapping_incomplete";
export interface SheetImportResult {
  ok: boolean; reason?: SheetImportFail; summary?: PlanSummary; created: number; merged: number; skipped: number; failed: number;
  /** Per-reason counts of rows that were not written (no cell values: never PII). */
  rejected: Record<string, number>;
}
export const SHEET_SOURCE = "sheets";

/** Mapping to use: the saved one, else the tenant's field map, else header auto-mapping. */
export function resolveMapping(cfg: Pick<SheetConfig, "mapping" | "object">, fieldMap: FieldMapSpec[], headers: string[], targets: TargetField[]): Mapping {
  if (hasMapping(cfg.mapping)) {
    const m: Mapping = {};
    for (const h of headers) m[h] = cfg.mapping[h] ?? "";
    return m;
  }
  const fromMap = mappingFromFieldMap(fieldMap, cfg.object, headers);
  return hasMapping(fromMap) ? fromMap : autoMap(headers, targets);
}

export interface RunInput { conn: ConnectionRow; gateway: SheetsGateway; port: SheetsImportPort; config: SheetConfig; fieldMap: FieldMapSpec[]; /** plan only: nothing is written */ dryRun?: boolean }

export type Prepared = { ok: true; sheet: ParsedSheet; targets: TargetField[]; mapping: Mapping; planned: PlannedRow[]; summary: PlanSummary } | { ok: false; reason: SheetImportFail };

/** Reads the range, maps the columns and plans every row. Writes nothing. */
export async function prepareSheetImport(i: Omit<RunInput, "dryRun">): Promise<Prepared> {
  let sheet: ParsedSheet;
  try { sheet = matrixToSheet(await i.gateway.readRange(i.config.spreadsheetId, i.config.range)); }
  catch (e) {
    if (e instanceof ImportError && (e.code === "empty" || e.code === "too_many_rows" || e.code === "too_many_columns")) return { ok: false, reason: e.code };
    if (e instanceof ImportError) return { ok: false, reason: "unreadable" };
    throw e;
  }
  const { tenantId, workspaceId } = i.conn, object = i.config.object;
  const targets = await i.port.targets({ tenantId, workspaceId, object });
  const mapping = resolveMapping(i.config, i.fieldMap, sheet.headers, targets);
  if (!checkMapping(mapping, targets, object).ok) return { ok: false, reason: "mapping_incomplete" };
  const { rows: planned, summary } = planImport({ object, rows: sheet.rows, mapping, targets, existing: await i.port.loadExisting(workspaceId, object) });
  return { ok: true, sheet, targets, mapping, planned, summary };
}

export async function runSheetImport(i: RunInput): Promise<SheetImportResult> {
  const prep = await prepareSheetImport(i);
  if (!prep.ok) return { ok: false, reason: prep.reason, created: 0, merged: 0, skipped: 0, failed: 0, rejected: {} };
  const { planned, summary } = prep, { tenantId, workspaceId } = i.conn, object = i.config.object;
  const rejected: Record<string, number> = {};
  for (const p of planned) if (p.status === "invalid") { const r = p.issues[0]?.reason ?? "invalid"; rejected[r] = (rejected[r] ?? 0) + 1; }
  if (i.dryRun) return { ok: true, summary, created: 0, merged: 0, skipped: 0, failed: 0, rejected };

  // Showcase rows are flagged synthetic so they can never be mistaken for the tenant's own data.
  const rows = i.gateway.kind === "mock" ? planned.map((p): PlannedRow => (p.status === "new" ? { ...p, record: { ...p.record, is_synthetic: true } } : p)) : planned;
  const res = await i.port.write(rows, { workspaceId, tenantId, object, mode: i.gateway.kind === "mock" ? "skip" : i.config.mode, source: SHEET_SOURCE });
  if (res.failed.length) rejected.write_failed = res.failed.length;
  return { ok: true, summary, created: res.created, merged: res.merged, skipped: res.skipped, failed: res.failed.length, rejected };
}
