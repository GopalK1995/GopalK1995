// The import planner: parsed rows + mapping + existing keys -> a per-row plan (new, duplicate, invalid) and totals.
// Pure and shared by the preview action, the job, and the demo dialog.
import type { CountryCode } from "libphonenumber-js/min";
import { findDuplicate, remember } from "./dedupe";
import { mapRow } from "./mapper";
import { emptyIndex, type ExistingIndex, type ImportObject, type Mapping, type ParsedRow, type PlannedRow, type PlanSummary, type TargetField } from "./types";

export interface PlanInput {
  object: ImportObject;
  rows: ParsedRow[];
  mapping: Mapping;
  targets: TargetField[];
  existing: ExistingIndex;
  region?: CountryCode;
}

export function planImport(input: PlanInput): { rows: PlannedRow[]; summary: PlanSummary } {
  const { object, targets } = input;
  const seen = emptyIndex();
  const out: PlannedRow[] = [];
  const customRequired = targets.filter((t) => t.required && t.key.startsWith("custom."));
  for (const row of input.rows) {
    const m = mapRow(row.cells, input.mapping, targets, input.region);
    const issues = [...m.issues];
    const r = m.record;
    const nameKey = object === "account" ? "name" : "full_name";
    if (!r[nameKey] && !issues.some((i) => i.field === nameKey)) issues.push({ field: nameKey, reason: "name_required" });
    if (object === "lead" && !r.email && !r.phone && !issues.some((i) => i.field === "email" || i.field === "phone")) issues.push({ field: "email", reason: "contact_required" });
    for (const t of customRequired) if (m.custom[t.key.slice(7)] === undefined && !issues.some((i) => i.field === t.key)) issues.push({ field: t.key, reason: "required_missing" });
    if (issues.length) { out.push({ rowNo: row.rowNo, status: "invalid", record: r, custom: m.custom, issues, dupId: null, dupKey: null }); continue; }
    const hit = findDuplicate(object, r, input.existing, seen);
    if (hit) {
      out.push({ rowNo: row.rowNo, status: "duplicate", record: r, custom: m.custom, issues: hit.id === null ? [{ field: hit.key, reason: "duplicate_in_file" }] : [], dupId: hit.id, dupKey: hit.key });
      continue;
    }
    remember(object, r, seen);
    out.push({ rowNo: row.rowNo, status: "new", record: r, custom: m.custom, issues: [], dupId: null, dupKey: null });
  }
  const summary: PlanSummary = { total: out.length, fresh: 0, duplicates: 0, invalid: 0 };
  for (const p of out) { if (p.status === "new") summary.fresh++; else if (p.status === "duplicate") summary.duplicates++; else summary.invalid++; }
  return { rows: out, summary };
}
