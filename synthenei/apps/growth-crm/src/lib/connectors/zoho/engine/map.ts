// Field map -> column specs, vendor fields <-> CRM column values. Pure.
// Tenant rows (integration_field_maps) replace the connector's defaults for the same external field (core effectiveMap).
import { effectiveMap } from "../../core/field-map";
import { TRANSFORMS, isTransformKey } from "../../core/transforms";
import type { FieldMapSpec, TransformKey } from "../../core/types";
import { ownerOf, type ColumnSpec } from "./conflict";
import { OBJECT_TABLE, PROTECTED_COLUMNS, type CrmObject } from "./types";

const COLUMN_RE = /^[a-z][a-z0-9_]{0,62}$/;
/** Transforms that make no sense in the CRM -> vendor direction (lossy or one-way). */
const NOT_REVERSIBLE = new Set<TransformKey>(["hash_sha256", "inr_paise_to_rupees", "micros_to_rupees"]);

export function effective(defaults: FieldMapSpec[], tenant: FieldMapSpec[]): FieldMapSpec[] { return effectiveMap(defaults, tenant); }

/** Specs for one object: rows for this vendor object and this CRM table, protected columns and bad names dropped. When two rows target one column the later one wins (tenant rows come after the defaults). */
export function specsFor(map: FieldMapSpec[], object: CrmObject, externalObject: string): ColumnSpec[] {
  const table = OBJECT_TABLE[object], byColumn = new Map<string, ColumnSpec>();
  for (const f of map) {
    if (f.externalObject !== externalObject || f.localTable !== table) continue;
    if (!COLUMN_RE.test(f.localColumn) || PROTECTED_COLUMNS.has(f.localColumn)) continue;
    if (f.transform && !isTransformKey(f.transform)) continue;
    byColumn.set(f.localColumn, { column: f.localColumn, externalField: f.externalField, direction: f.direction, owner: ownerOf(f), transform: f.transform ?? null, transformArg: f.transformArg ?? null });
  }
  return [...byColumn.values()];
}

const pick = (obj: Record<string, unknown>, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o != null && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

export interface MappedIn { values: Record<string, unknown>; rejected: string[] }
/** Vendor fields -> CRM column values. An empty vendor value is null; a field that is missing, or whose transform fails, is left out (unknown). */
export function mapIn(fields: Record<string, unknown>, specs: ColumnSpec[]): MappedIn {
  const out: MappedIn = { values: {}, rejected: [] };
  for (const s of specs) {
    if (s.direction === "out") continue;
    const raw = pick(fields, s.externalField);
    if (raw === undefined) continue;
    if (raw === null || raw === "") { out.values[s.column] = null; continue; }
    if (!s.transform) { out.values[s.column] = raw; continue; }
    const v = TRANSFORMS[s.transform](raw, s.transformArg ?? null);
    if (v === null) out.rejected.push(`transform_failed:${s.externalField}`); else out.values[s.column] = v;
  }
  return out;
}

/** The vendor label for a CRM stage key: the first entry of the stage_key_map that maps to it. */
export function reverseStage(arg: Record<string, unknown> | null | undefined, key: unknown): string | null {
  const map = (arg?.map ?? {}) as Record<string, string>;
  for (const [label, k] of Object.entries(map)) if (k === key) return label;
  return null;
}

/** CRM column values -> vendor fields for the columns in `patch`. Only out/both columns with a reversible transform; others are skipped. */
export function mapOut(patch: Record<string, unknown>, specs: ColumnSpec[]): { fields: Record<string, unknown>; skipped: string[] } {
  const fields: Record<string, unknown> = {}, skipped: string[] = [];
  for (const s of specs) {
    if (!(s.column in patch) || s.direction === "in") continue;
    const v = patch[s.column];
    if (s.transform && NOT_REVERSIBLE.has(s.transform)) { skipped.push(`not_reversible:${s.externalField}`); continue; }
    if (s.transform === "stage_key_map") {
      const label = v === null ? null : reverseStage(s.transformArg, v);
      if (v !== null && label === null) { skipped.push(`stage_unmapped:${s.externalField}`); continue; }
      fields[s.externalField] = label;
    } else fields[s.externalField] = v;
  }
  return { fields, skipped };
}

/** Vendor fields the engine asks for: every mapped external field (the gateway expands synthetic ones). */
export const wantedFields = (specs: ColumnSpec[]): string[] => [...new Set(specs.map((s) => s.externalField))];

/** Dotted keys become nested objects: vendors wrap lookups in objects, field maps address them with a dotted path. */
export function expandDotted(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    const parts = k.split(".");
    let o = out;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) { o[p] = v; return; }
      if (typeof o[p] !== "object" || o[p] === null) o[p] = {};
      o = o[p] as Record<string, unknown>;
    });
  }
  return out;
}
