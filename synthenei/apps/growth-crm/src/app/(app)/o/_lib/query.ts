// Pure list logic for custom-object pages: URL params -> {search, filters, sort}, in-memory evaluation (demo data and the
// operators the database cannot express safely through PostgREST), and the display title. Filters use T030's grammar
// (`custom.<key>` ids, eq | neq | in | contains) so a URL, a saved view and the public API describe the same filter.
import { columnId, matchesFilter, parseFilterParams, type FieldFilters } from "@/lib/metadata/filters";
import type { FieldDef } from "@/lib/metadata/types";
import type { ObjectRecord, SortSpec } from "./types";

export interface ListQuery { q: string; filters: FieldFilters; sort: SortSpec[]; viewId: string | null }

/** `?q=&view=&sort=custom.key:desc&custom.status=active&custom.status.op=eq`. Unknown or retired fields are ignored. */
export function parseListQuery(defs: FieldDef[], params: URLSearchParams, o: { sortable?: string[] } = {}): ListQuery {
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const sortRaw = params.get("sort") ?? "";
  const [id, dir] = sortRaw.split(":");
  const sortable = new Set(o.sortable ?? ["title", "updated_at", ...defs.filter((d) => !d.archivedAt).map((d) => columnId(d.key))]);
  const sort: SortSpec[] = id && sortable.has(id) ? [{ id, desc: dir === "desc" }] : [];
  const view = params.get("view");
  return { q, filters: parseFilterParams(defs, params), sort, viewId: view && view.length <= 64 ? view : null };
}

export const sortToParam = (s: SortSpec[]): string => (s[0] ? `${s[0].id}:${s[0].desc ? "desc" : "asc"}` : "");

const keyOf = (id: string) => (id.startsWith("custom.") ? id.slice(7) : null);

/** Filters the database cannot evaluate exactly (not-equal keeps nulls out of `eq`; multi-select contains is an array test). */
export function needsMemoryPass(defs: FieldDef[], filters: FieldFilters): boolean {
  return Object.entries(filters).some(([id, f]) => {
    const d = defs.find((x) => x.key === keyOf(id));
    return f.op === "neq" || (d?.type === "multi_select" && f.op === "contains");
  });
}

export function applyFilters(rows: ObjectRecord[], defs: FieldDef[], filters: FieldFilters, q = "", primaryKey?: string | null): ObjectRecord[] {
  const needle = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (needle && !displayTitle(r, primaryKey).toLowerCase().includes(needle)) return false;
    for (const [id, f] of Object.entries(filters)) {
      const key = keyOf(id);
      const def = defs.find((d) => d.key === key);
      if (!key || !def) continue;
      if (!matchesFilter(def, f, r.data[key])) return false;
    }
    return true;
  });
}

const cmp = (a: unknown, b: unknown): number => {
  const an = a === null || a === undefined || a === "", bn = b === null || b === undefined || b === "";
  if (an || bn) return an === bn ? 0 : an ? 1 : -1;   // empty last
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

export function sortRecords(rows: ObjectRecord[], sort: SortSpec[], primaryKey?: string | null): ObjectRecord[] {
  const s = sort[0];
  if (!s) return rows;
  const val = (r: ObjectRecord) => (s.id === "title" ? displayTitle(r, primaryKey) : s.id === "updated_at" ? r.updatedAt : r.data[keyOf(s.id) ?? ""]);
  const out = [...rows].sort((a, b) => {
    const av = val(a), bv = val(b);
    const empty = av === null || av === undefined || av === "", bempty = bv === null || bv === undefined || bv === "";
    if (empty || bempty) return cmp(av, bv);   // empty values stay last in both directions
    return s.desc ? -cmp(av, bv) : cmp(av, bv);
  });
  return out;
}

/** The record's title: the primary field's value when present (kept in sync by every write path), else the stored title. */
export function displayTitle(r: Pick<ObjectRecord, "title" | "data">, primaryKey?: string | null): string {
  const v = primaryKey ? r.data[primaryKey] : undefined;
  return typeof v === "string" && v.trim() ? v : r.title;
}
