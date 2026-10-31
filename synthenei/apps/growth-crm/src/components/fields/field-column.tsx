// Table and filter providers for DataTableV2 and the filter bar. Column ids are `custom.<key>` (saved-view compatible).
// Rows carry their custom values under `custom`; values the viewer may not see are already absent (server-side masking),
// and columns are only built for fields the viewer can see.
import type { DataTableV2Column } from "@/components/ui/data-table-v2";
import type { FilterDef } from "@/components/ui/filter-bar";
import { choiceLabel, pickLabel } from "./labels";
import { FieldValue } from "./field-value";
import { columnId, isFilterable } from "@/lib/metadata/filters";
import type { ClientField } from "@/lib/metadata/runtime";
import type { FieldDef } from "@/lib/metadata/types";
import type { FieldsLocale } from "@/lib/metadata/strings";
import { ft } from "@/lib/metadata/strings";

export interface CustomRow { custom?: Record<string, unknown> | null }
type ColDef = Pick<ClientField, "key" | "label" | "type" | "choices">;

const NUMERIC = new Set(["number", "money", "percent", "rating"]);

/** tanstack column (v9, DataTableV2). Sorts empty values last. Add the id to `numericColumns` for numeric types (see isNumericColumn). */
export function fieldColumn<T extends CustomRow>(def: ColDef, o: { locale?: FieldsLocale; resolve?: (id: string) => string | undefined } = {}): DataTableV2Column<T> {
  const locale = o.locale ?? "en";
  return {
    id: columnId(def.key),
    header: pickLabel(def.label, locale),
    accessorFn: (row: T) => (row.custom ?? {})[def.key] ?? null,
    enableSorting: def.type !== "multi_select" && def.type !== "long_text",
    cell: (ctx: { row: { original: T } }) => <FieldValue def={def} value={(ctx.row.original.custom ?? {})[def.key]} locale={locale} resolve={o.resolve} />,
  } as DataTableV2Column<T>;
}

/** Columns for every visible, active field the page decided to show (ids for `saved_views.columns`). */
export function fieldColumns<T extends CustomRow>(defs: ColDef[], o: { locale?: FieldsLocale; resolve?: (id: string) => string | undefined } = {}): DataTableV2Column<T>[] {
  return defs.map((d) => fieldColumn<T>(d, o));
}
export const isNumericColumn = (def: Pick<ClientField, "type">): boolean => NUMERIC.has(def.type);
export const numericColumnIds = (defs: ColDef[]): string[] => defs.filter(isNumericColumn).map((d) => columnId(d.key));

/** URL-driven select filters (FilterBar) for the select-like fields; text-like ones use <FieldFilter/> or the search box. */
export function fieldFilterDefs(defs: (FieldDef | ColDef)[], locale: FieldsLocale = "en"): FilterDef[] {
  return defs.flatMap((d) => {
    const filterable = "isFilterable" in d ? isFilterable(d as FieldDef) : true;
    if (!filterable) return [];
    if (d.type === "select" || d.type === "multi_select") {
      const choices = "choices" in d ? d.choices : (d as FieldDef).options.choices;
      return [{ key: columnId(d.key), label: pickLabel(d.label, locale), options: (choices ?? []).filter((c) => !c.archived).map((c) => ({ value: c.key, label: choiceLabel(c, locale) })) }];
    }
    if (d.type === "boolean") return [{ key: columnId(d.key), label: pickLabel(d.label, locale), options: [{ value: "true", label: ft("yes", {}, locale) }, { value: "false", label: ft("no", {}, locale) }] }];
    return [];
  });
}
