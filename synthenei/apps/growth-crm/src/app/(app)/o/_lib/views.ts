// Saved-view rules (pure). A view stores columns (`title`, `custom.<key>`), filters (`custom.<key>` -> {op,value}) and a sort.
// Private views are always allowed; team and workspace visibility need views.share (RLS enforces the same on saved_views).
// Retired fields are dropped on load (T030 fromSavedView), so a view never breaks when a field is retired.
import { columnId, fromSavedView, isFilterable, opsFor, type FieldFilters } from "@/lib/metadata/filters";
import type { FieldDef } from "@/lib/metadata/types";
import { TITLE_COLUMN } from "@/lib/layouts/spec";
import type { ListQuery } from "./query";
import { VIEW_VISIBILITIES, type SavedView, type SortSpec, type ViewVisibility } from "./types";

export const VIEW_NAME_MAX = 80;
export interface ViewInput { name: string; visibility: ViewVisibility; filters: FieldFilters; sort: SortSpec[]; columns: string[] }
export interface ViewIssue { path: string; code: "name" | "visibility" | "share" | "filters" | "columns" | "sort" }

/** Clean a view payload against the live field definitions. Unknown fields and bad operators are dropped, not trusted. */
export function sanitizeView(defs: FieldDef[], raw: { name?: unknown; visibility?: unknown; filters?: unknown; sort?: unknown; columns?: unknown }, canShare: boolean): { value: ViewInput; issues: ViewIssue[] } {
  const issues: ViewIssue[] = [];
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > VIEW_NAME_MAX) issues.push({ path: "name", code: "name" });
  const visibility = (VIEW_VISIBILITIES as string[]).includes(String(raw.visibility)) ? (raw.visibility as ViewVisibility) : "private";
  if (raw.visibility !== undefined && !(VIEW_VISIBILITIES as string[]).includes(String(raw.visibility))) issues.push({ path: "visibility", code: "visibility" });
  if (visibility !== "private" && !canShare) issues.push({ path: "visibility", code: "share" });

  const filters: FieldFilters = {};
  const rawF = raw.filters && typeof raw.filters === "object" && !Array.isArray(raw.filters) ? (raw.filters as Record<string, unknown>) : {};
  for (const def of defs) {
    if (!isFilterable(def)) continue;
    const f = rawF[columnId(def.key)];
    if (!f || typeof f !== "object") continue;
    const { op, value } = f as { op?: unknown; value?: unknown };
    if (typeof op !== "string" || !(opsFor(def) as string[]).includes(op)) continue;
    const v = Array.isArray(value) ? value.map(String).filter(Boolean).slice(0, 50) : typeof value === "string" ? value.slice(0, 200) : null;
    if (v === null || (Array.isArray(v) ? !v.length : v === "")) continue;
    filters[columnId(def.key)] = { op: op as FieldFilters[string]["op"], value: v };
  }
  const live = new Set(defs.filter((d) => !d.archivedAt).map((d) => columnId(d.key)));
  const columns = (Array.isArray(raw.columns) ? raw.columns : []).filter((c): c is string => typeof c === "string" && (c === TITLE_COLUMN || live.has(c))).filter((c, i, a) => a.indexOf(c) === i).slice(0, 12);
  if (columns.length && !columns.includes(TITLE_COLUMN)) columns.unshift(TITLE_COLUMN);
  const sortOk = new Set<string>([TITLE_COLUMN, "updated_at", ...live]);
  const sort = (Array.isArray(raw.sort) ? raw.sort : []).flatMap((s): SortSpec[] => (s && typeof s === "object" && typeof (s as SortSpec).id === "string" && sortOk.has((s as SortSpec).id) ? [{ id: (s as SortSpec).id, desc: (s as SortSpec).desc === true }] : [])).slice(0, 1);
  return { value: { name, visibility, filters, sort, columns }, issues };
}

/** Owner edits their own view; views.share holders may edit any visible view (RLS allows the same). */
export const canEditView = (v: Pick<SavedView, "ownerId">, uid: string, canShare: boolean): boolean => v.ownerId === uid || canShare;

/** A saved view's columns/filters/sort with retired fields dropped. */
export function resolveView(defs: FieldDef[], view: SavedView): SavedView {
  const live = fromSavedView(defs, { columns: view.columns.filter((c) => c !== TITLE_COLUMN), filters: view.filters });
  const keepTitle = view.columns.includes(TITLE_COLUMN) ? [TITLE_COLUMN] : [];
  const liveCols = new Set(defs.filter((d) => !d.archivedAt).map((d) => columnId(d.key)));
  return { ...view, columns: view.columns.length ? [...keepTitle, ...live.columns] : [], filters: live.filters, sort: view.sort.filter((s) => s.id === TITLE_COLUMN || s.id === "updated_at" || liveCols.has(s.id)) };
}

/** Effective query: the view's filters and sort, overridden by anything set explicitly in the URL. */
export function effectiveQuery(defs: FieldDef[], q: ListQuery, view: SavedView | null): { filters: FieldFilters; sort: SortSpec[]; columns: string[] } {
  if (!view) return { filters: q.filters, sort: q.sort, columns: [] };
  const v = resolveView(defs, view);
  return { filters: { ...v.filters, ...q.filters }, sort: q.sort.length ? q.sort : v.sort, columns: v.columns };
}
