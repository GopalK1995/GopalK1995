"use client";
// DataTableV2: tanstack table (v9) in the ledger zone. Real <table>, 36 px rows, 12 px type, sortable headers,
// mono tabular numbers via ColumnMeta-free `numeric` flag on the column id list. Server-safe DataTable stays in data-table.tsx.
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { createSortedRowModel, flexRender, rowSortingFeature, sortFns, tableFeatures, useTable, type ColumnDef, type RowData, type SortingState } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState } from "./states";
import { SkeletonRows } from "./skeleton";

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns });

export type DataTableV2Column<T extends RowData> = ColumnDef<typeof features, T>;

export type DataTableV2Props<T extends RowData> = {
  data: T[];
  columns: DataTableV2Column<T>[];
  getRowId: (row: T) => string;
  caption: string;
  /** Column ids rendered right-aligned in mono tabular figures. */
  numericColumns?: string[];
  onRowClick?: (row: T) => void;
  loading?: boolean;
  error?: { source: string; message: string; retry?: React.ReactNode };
  empty?: { title: string; body?: React.ReactNode; action?: React.ReactNode };
  /** 36 px rows (table, default) or 40 px (list). */
  density?: "table" | "list";
  className?: string;
};

export function DataTableV2<T extends RowData>({ data, columns, getRowId, caption, numericColumns = [], onRowClick, loading, error, empty, density = "table", className }: DataTableV2Props<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useTable({ features, columns, data, getRowId, state: { sorting }, onSortingChange: setSorting });
  if (error) return <ErrorState source={error.source} message={error.message} retry={error.retry} />;
  if (loading) return <SkeletonRows rows={6} className={className} />;
  if (!data.length) return <EmptyState title={empty?.title ?? "Nothing here yet"} body={empty?.body} action={empty?.action} />;
  const isNum = (id: string) => numericColumns.includes(id);
  return (
    <div className={cn("scrollbar-thin relative overflow-x-auto", className)}>
      <table className="zone-ledger w-full border-collapse" data-density={density}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-y border-line bg-paper-2">
              {hg.headers.map((h) => {
                const dir = h.column.getIsSorted();
                const canSort = h.column.getCanSort();
                const label = h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext());
                return (
                  <th key={h.id} scope="col" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : canSort ? "none" : undefined}
                    className={cn("label-caps h-9 whitespace-nowrap text-left font-medium", isNum(h.column.id) && "text-right")}>
                    {canSort ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 rounded-chip hover:text-ink">
                        {label}
                        {dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : dir === "desc" ? <ArrowDown className="size-3" aria-hidden /> : null}
                      </button>
                    ) : label}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} data-row
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(row.original); } } : undefined}
              className={cn("border-b border-line last:border-0 hover:bg-paper", onRowClick && "cursor-pointer")}>
              {row.getAllCells().map((cell) => (
                <td key={cell.id} className={cn("whitespace-nowrap text-ink", isNum(cell.column.id) && "num-mono text-right")}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
