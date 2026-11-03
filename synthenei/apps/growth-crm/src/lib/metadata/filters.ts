// Filters and column ids for custom fields. Same operators as the public API (filter[custom.<key>][eq|neq|in|contains]),
// so a saved view, a URL and an API call describe the same filter. Saved views store:
//   columns: ["custom.<key>", ...]      filters: { "custom.<key>": { op, value } }
import type { FieldDef, FieldType } from "./types";

export type FilterOp = "eq" | "neq" | "in" | "contains";
export interface FieldFilterValue { op: FilterOp; value: string | string[] }
export type FieldFilters = Record<string, FieldFilterValue>;

export const columnId = (key: string): string => `custom.${key}`;
export const keyOfColumn = (id: string): string | null => (id.startsWith("custom.") ? id.slice(7) : null);

const TEXTY: FieldType[] = ["text", "long_text", "email", "phone", "url"];
/** Operators a field type supports in the UI. Matches what the API accepts for custom fields. */
export function opsFor(def: Pick<FieldDef, "type">): FilterOp[] {
  if (TEXTY.includes(def.type)) return ["contains", "eq", "neq"];
  if (def.type === "select") return ["in", "eq", "neq"];
  if (def.type === "multi_select") return ["contains", "in"];
  return ["eq", "neq"];
}
export const isFilterable = (def: FieldDef): boolean => def.isFilterable && !def.archivedAt && def.type !== "long_text";

const API_KEY = /^[a-z][a-z0-9_]{1,40}$/;

/** `filter[custom.key]=v` / `filter[custom.key][op]=v` query entries for the public API or a data loader. */
export function toQueryEntries(filters: FieldFilters): [string, string][] {
  const out: [string, string][] = [];
  for (const [id, f] of Object.entries(filters)) {
    const key = keyOfColumn(id);
    if (!key || !API_KEY.test(key)) continue;
    const v = Array.isArray(f.value) ? f.value.join(",") : f.value;
    if (v === "") continue;
    out.push([f.op === "eq" ? `filter[custom.${key}]` : `filter[custom.${key}][${f.op}]`, v]);
  }
  return out;
}

/** Reads `custom.<key>` filters out of page search params (op in `custom.<key>.op`), ignoring unknown, retired and non-filterable fields. */
export function parseFilterParams(defs: FieldDef[], params: URLSearchParams): FieldFilters {
  const out: FieldFilters = {};
  for (const def of defs) {
    if (!isFilterable(def)) continue;
    const raw = params.get(columnId(def.key));
    if (raw === null || raw === "") continue;
    const opRaw = params.get(`${columnId(def.key)}.op`) as FilterOp | null;
    const op = opRaw && opsFor(def).includes(opRaw) ? opRaw : opsFor(def)[0];
    out[columnId(def.key)] = { op, value: op === "in" ? raw.split(",").filter(Boolean) : raw };
  }
  return out;
}

export function filtersToParams(filters: FieldFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, f] of Object.entries(filters)) {
    out[id] = Array.isArray(f.value) ? f.value.join(",") : f.value;
    out[`${id}.op`] = f.op;
  }
  return out;
}

/** In-memory evaluation (demo data and client-side tables). The database does the same for real data through the API. */
export function matchesFilter(def: Pick<FieldDef, "type">, f: FieldFilterValue, stored: unknown): boolean {
  const vals = Array.isArray(stored) ? stored.map(String) : stored === null || stored === undefined ? [] : [String(stored)];
  const want = Array.isArray(f.value) ? f.value : [f.value];
  switch (f.op) {
    case "eq": return vals.includes(want[0]);
    case "neq": return !vals.includes(want[0]);
    case "in": return vals.some((v) => want.includes(v));
    case "contains":
      return def.type === "multi_select" ? want.every((w) => vals.includes(w)) : vals.some((v) => v.toLowerCase().includes(String(want[0]).toLowerCase()));
  }
}

/** Saved view payload for the custom part of a view: stays valid when fields are retired (they are dropped on load). */
export function toSavedView(columns: string[], filters: FieldFilters): { columns: string[]; filters: FieldFilters } {
  return { columns: columns.filter((c) => keyOfColumn(c)), filters };
}
export function fromSavedView(defs: FieldDef[], view: { columns: string[]; filters: FieldFilters }): { columns: string[]; filters: FieldFilters } {
  const live = new Set(defs.filter((d) => !d.archivedAt).map((d) => columnId(d.key)));
  const filt = new Set(defs.filter(isFilterable).map((d) => columnId(d.key)));
  return {
    columns: view.columns.filter((c) => !keyOfColumn(c) || live.has(c)),
    filters: Object.fromEntries(Object.entries(view.filters).filter(([id]) => !keyOfColumn(id) || filt.has(id))),
  };
}
