// Field-mapping engine: applies integration_field_maps (or the connector default) to an external record.
// Pure. The tenant's saved rows replace the default map for the same (externalObject, externalField).
import { TRANSFORMS, isTransformKey } from "./transforms";
import type { FieldMapSpec, TransformKey } from "./types";

export interface MappedRecord { byTable: Record<string, Record<string, unknown>>; rejected: { field: string; reason: "missing" | "transform_failed" }[] }

const pick = (obj: Record<string, unknown>, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o != null && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

/** Tenant rows win over defaults for the same external field. Rows whose transform is unknown are dropped (validated at save). */
export function effectiveMap(defaults: FieldMapSpec[], tenant: FieldMapSpec[]): FieldMapSpec[] {
  const k = (f: FieldMapSpec) => `${f.externalObject}\u0000${f.externalField}`;
  const m = new Map(defaults.map((f) => [k(f), f]));
  for (const f of tenant) m.set(k(f), f);
  return [...m.values()];
}

/** Maps one inbound external record. Fields the vendor did not send are skipped silently; a failing transform is reported. */
export function applyFieldMap(map: FieldMapSpec[], externalObject: string, record: Record<string, unknown>, direction: "in" | "out" = "in"): MappedRecord {
  const out: MappedRecord = { byTable: {}, rejected: [] };
  for (const f of map) {
    if (f.externalObject !== externalObject) continue;
    if (f.direction !== "both" && f.direction !== direction) continue;
    const raw = pick(record, f.externalField);
    if (raw === undefined || raw === null || raw === "") continue;
    let v: unknown = raw;
    if (f.transform) {
      if (!isTransformKey(f.transform)) { out.rejected.push({ field: f.externalField, reason: "transform_failed" }); continue; }
      v = TRANSFORMS[f.transform as TransformKey](raw, f.transformArg ?? null);
      if (v === null) { out.rejected.push({ field: f.externalField, reason: "transform_failed" }); continue; }
    }
    (out.byTable[f.localTable] ??= {})[f.localColumn] = v;
  }
  return out;
}

export interface MapIssue { index: number; message: string }
/** Validates an edited map before it is saved (editor + server action). */
export function validateFieldMap(rows: FieldMapSpec[], allowedTables: readonly string[]): MapIssue[] {
  const issues: MapIssue[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    if (!r.externalObject.trim() || !r.externalField.trim()) issues.push({ index: i, message: "external_required" });
    if (!allowedTables.includes(r.localTable)) issues.push({ index: i, message: "table_not_allowed" });
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(r.localColumn)) issues.push({ index: i, message: "column_invalid" });
    if (r.transform && !isTransformKey(r.transform)) issues.push({ index: i, message: "transform_unknown" });
    if (r.transform === "stage_key_map" && (r.transformArg == null || typeof r.transformArg.map !== "object")) issues.push({ index: i, message: "stage_map_required" });
    const k = `${r.externalObject}\u0000${r.externalField}`;
    if (seen.has(k)) issues.push({ index: i, message: "duplicate" });
    seen.add(k);
  });
  return issues;
}

/** integration_field_maps.transform is one text column: "key" or "key:{json arg}" (stage_key_map). */
export function encodeTransform(key: string | null | undefined, arg?: Record<string, unknown> | null): string | null {
  if (!key) return null;
  return arg && Object.keys(arg).length ? `${key}:${JSON.stringify(arg)}` : key;
}
