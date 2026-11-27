"use client";
// DataGrid: the canonical CRM table (AUD-055, COMP-027/028/029). One DOM structure, a real <table>, ledger density.
//   - typed generic columns; sortable headers with aria-sort (client sort, or server sort via `sort` + `onSortChange`/`sortHref`)
//   - optional row selection: select-all for the visible page (tri-state), per-row checkboxes, polite live region with the count
//   - pagination: client (slices rows), server (page/total) or keyset (prev/next only, no total); counts never render NaN
//   - sticky header (give `maxHeight`), density, column visibility chooser, row actions menu, loading skeleton, empty/error slots
//   - the horizontal scroll region is focusable (role=region, named, visible focus ring); rows use a roving tabindex (arrows, Home, End)
//   - responsive="stack" turns rows into labelled cards below md with CSS only (no second copy of the rows in the DOM)
// The old DataTable (data-table.tsx, server-safe, two copies of every row) and DataTableV2 stay until their callers move (docs/tasks/AUD-055.md).
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./dropdown";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { EmptyState, ErrorState } from "./states";
import { SkeletonRows } from "./skeleton";

export type SortDir = "asc" | "desc";
export type SortValue = string | number | boolean | Date | null | undefined;

export type DataGridColumn<T> = {
  id: string;
  header: ReactNode;
  /** Plain-text name for the column chooser and the stacked mobile label. Defaults to `header` when it is a string. */
  label?: string;
  cell: (row: T) => ReactNode;
  /** Client sorting: a value to compare. Presence makes the column sortable. */
  sortValue?: (row: T) => SortValue;
  /** Server sorting: mark the column sortable without a client comparator (use with `sort` and `onSortChange` or `sortHref`). */
  sortable?: boolean;
  align?: "left" | "right";
  className?: string;
  /** Render the cell as <th scope="row"> (the record name). One per table is plenty. */
  rowHeader?: boolean;
  /** Never offered in the column chooser (e.g. the name). */
  alwaysVisible?: boolean;
  defaultHidden?: boolean;
  /** Stacked layout only: hide this column on small screens. */
  hideOnStack?: boolean;
};

export type RowAction<T> = { key: string; label: string; onSelect: (row: T) => void; disabled?: boolean };

export type DataGridPagination =
  | { mode: "client"; pageSize?: number; pageSizeLabel?: never }
  | { mode: "server"; page: number; pageSize: number; total: number; onPageChange?: (page: number) => void; hrefForPage?: (page: number) => string }
  | { mode: "keyset"; hasPrev: boolean; hasNext: boolean; onPrev?: () => void; onNext?: () => void; prevHref?: string; nextHref?: string };

export type DataGridProps<T> = {
  rows: T[];
  columns: DataGridColumn<T>[];
  rowId: (row: T) => string;
  /** Accessible name of the table (caption) and of its scroll region. */
  caption: string;
  /** Spoken name of one row, for the select checkbox and the actions button. Defaults to the row id. */
  rowLabel?: (row: T) => string;
  density?: "table" | "list";
  stickyHeader?: boolean;
  /** CSS max-height of the scroll region; needed for the sticky header to stick vertically. */
  maxHeight?: string;
  /** Minimum table width in px before the region scrolls sideways. */
  minWidth?: number;
  responsive?: "scroll" | "stack";
  loading?: boolean;
  error?: { source: string; message: string; retry?: ReactNode };
  empty?: { title: string; body?: ReactNode; action?: ReactNode };
  /** Selection. Pass `selected` + `onSelectedChange` to control it; omit them to let the grid keep it. */
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (ids: Set<string>) => void;
  /** Rendered in the toolbar when something is selected (bulk actions). Receives the selected ids. */
  bulkActions?: (ids: string[]) => ReactNode;
  /** Total matching rows when the dataset is bigger than `rows` (server pagination); used in "x of y selected". */
  totalCount?: number;
  /** Server sort state (controls aria-sort and the arrow). Client sort keeps its own state when omitted. */
  sort?: { id: string; dir: SortDir } | null;
  onSortChange?: (id: string, dir: SortDir) => void;
  sortHref?: (id: string, nextDir: SortDir) => string;
  pagination?: DataGridPagination;
  rowActions?: (row: T) => RowAction<T>[];
  /** Keep the "n of m selected" text for screen readers only (the page shows its own count). */
  hideSelectionText?: boolean;
  /** Show the Columns chooser. */
  columnControl?: boolean;
  onRowActivate?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  /** Extra toolbar content (filters, export). */
  toolbar?: ReactNode;
  className?: string;
  /** Test hook on the table element. */
  "data-testid"?: string;
};

/** Never NaN, never negative: counts shown to people come through here. */
export const safeCount = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

function compare(a: SortValue, b: SortValue): number {
  const an = a === null || a === undefined || (typeof a === "number" && Number.isNaN(a));
  const bn = b === null || b === undefined || (typeof b === "number" && Number.isNaN(b));
  if (an || bn) return an === bn ? 0 : an ? 1 : -1; // empty values last, in both directions (handled by caller)
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}
const isEmptyVal = (v: SortValue) => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));

const textLabel = <T,>(c: DataGridColumn<T>) => c.label ?? (typeof c.header === "string" ? c.header : c.id);

export function DataGrid<T>(props: DataGridProps<T>) {
  const {
    rows, columns, rowId, caption, rowLabel, density = "table", stickyHeader = true, maxHeight, minWidth = 640, responsive = "scroll",
    loading, error, empty, selectable, selected, onSelectedChange, bulkActions, totalCount, sort: sortProp, onSortChange, sortHref,
    pagination, rowActions, columnControl, onRowActivate, rowClassName, toolbar, className, hideSelectionText,
  } = props;
  const uid = useId();
  const labelOf = rowLabel ?? rowId;
  const stack = responsive === "stack";

  // ---- column visibility
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.id)));
  const visible = useMemo(() => columns.filter((c) => c.alwaysVisible || !hidden.has(c.id)), [columns, hidden]);

  // ---- sort: server (controlled by `sort`) or client (own state)
  const serverSort = sortProp !== undefined || onSortChange !== undefined || sortHref !== undefined;
  const [clientSort, setClientSort] = useState<{ id: string; dir: SortDir } | null>(null);
  const sort = serverSort ? sortProp ?? null : clientSort;
  const sorted = useMemo(() => {
    if (serverSort || !clientSort) return rows;
    const col = columns.find((c) => c.id === clientSort.id);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue, sign = clientSort.dir === "asc" ? 1 : -1;
    return rows
      .map((r, i) => ({ r, i, v: sv(r) }))
      .sort((x, y) => {
        const ex = isEmptyVal(x.v), ey = isEmptyVal(y.v);
        if (ex || ey) return ex === ey ? x.i - y.i : ex ? 1 : -1; // empty last whatever the direction
        return sign * compare(x.v, y.v) || x.i - y.i;
      })
      .map((x) => x.r);
  }, [rows, columns, clientSort, serverSort]);
  const nextDir = (id: string): SortDir => (sort?.id === id && sort.dir === "asc" ? "desc" : "asc");
  const onSortClick = (id: string) => {
    if (serverSort) { onSortChange?.(id, nextDir(id)); return; }
    // none -> asc -> desc -> none
    setClientSort((s) => (!s || s.id !== id ? { id, dir: "asc" } : s.dir === "asc" ? { id, dir: "desc" } : null));
  };

  // ---- pagination
  const [page, setPage] = useState(0); // client mode, zero-based
  const clientSize = pagination?.mode === "client" ? Math.max(1, safeCount(pagination.pageSize ?? 25) || 25) : 0;
  const pageCount = clientSize ? Math.max(1, Math.ceil(sorted.length / clientSize)) : 1;
  useEffect(() => { if (page > pageCount - 1) setPage(pageCount - 1); }, [page, pageCount]);
  const shown = clientSize ? sorted.slice(page * clientSize, page * clientSize + clientSize) : sorted;

  // ---- selection
  const [innerSel, setInnerSel] = useState<Set<string>>(new Set());
  const sel: ReadonlySet<string> = selected ?? innerSel;
  const setSel = useCallback((next: Set<string>) => { if (selected === undefined) setInnerSel(next); onSelectedChange?.(next); }, [selected, onSelectedChange]);
  const pageIds = shown.map(rowId);
  const selectedOnPage = pageIds.filter((id) => sel.has(id)).length;
  const allOnPage = pageIds.length > 0 && selectedOnPage === pageIds.length;
  const someOnPage = selectedOnPage > 0 && !allOnPage;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = someOnPage; }, [someOnPage]);
  const toggleAll = () => { const n = new Set(sel); pageIds.forEach((id) => (allOnPage ? n.delete(id) : n.add(id))); setSel(n); };
  const toggleOne = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  const selCount = safeCount(sel.size);
  const totalForCount = safeCount(totalCount ?? (pagination?.mode === "server" ? pagination.total : sorted.length));
  const liveText = selectable ? (selCount ? `${selCount} of ${Math.max(totalForCount, selCount)} selected` : "") : "";

  // ---- keyboard: roving tabindex over rows
  const [active, setActive] = useState(0);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  useEffect(() => { if (active > shown.length - 1) setActive(Math.max(0, shown.length - 1)); }, [active, shown.length]);
  const focusRow = (i: number) => {
    const n = Math.min(Math.max(i, 0), shown.length - 1);
    setActive(n);
    bodyRef.current?.querySelectorAll<HTMLElement>("tr[data-row]")[n]?.focus();
  };
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, i: number, row: T) => {
    const t = e.target as HTMLElement;
    const onRow = t === e.currentTarget, onBox = t instanceof HTMLInputElement && t.type === "checkbox";
    if (!onRow && !onBox) return;
    if (e.key === "ArrowDown") { e.preventDefault(); focusRow(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusRow(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusRow(0); }
    else if (e.key === "End") { e.preventDefault(); focusRow(shown.length - 1); }
    else if (onRow && selectable && e.key === " ") { e.preventDefault(); toggleOne(rowId(row)); }
    else if (onRow && onRowActivate && e.key === "Enter") { e.preventDefault(); onRowActivate(row); }
  };

  // ---- early states (loading / error); hooks above always run
  if (error) return <ErrorState source={error.source} message={error.message} retry={error.retry} />;
  if (loading) return <SkeletonRows rows={6} className={className} />;

  const showEmpty = rows.length === 0;
  const stackCls = stack;
  const hasToolbar = !!toolbar || columnControl || selectable;

  return (
    <div className={cn("flex flex-col", className)}>
      {hasToolbar && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-12 text-ink-3">
            {/* Polite live region: always mounted so the first change is announced. */}
            <span role="status" aria-live="polite" aria-atomic="true" className={cn("num", (!liveText || hideSelectionText) && "sr-only")}>{liveText}</span>
            {selCount > 0 && bulkActions?.([...sel])}
            {toolbar}
          </div>
          {columnControl && (
            <Popover>
              <PopoverTrigger asChild><Button size="sm" variant="ghost"><Columns3 aria-hidden />Columns</Button></PopoverTrigger>
              <PopoverContent align="end" className="w-56">
                <fieldset>
                  <legend className="mb-1 text-12 font-medium uppercase tracking-wide text-ink-3">Show columns</legend>
                  <div className="flex flex-col gap-1">
                    {columns.filter((c) => !c.alwaysVisible).map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-13 text-ink">
                        <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={!hidden.has(c.id)}
                          onChange={() => setHidden((h) => { const n = new Set(h); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} />
                        {textLabel(c)}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}

      {showEmpty ? (
        <div className="p-3 sm:p-4"><EmptyState title={empty?.title ?? "Nothing here yet"} body={empty?.body} action={empty?.action} /></div>
      ) : (
        <div
          role="region" aria-label={caption} tabIndex={0}
          style={maxHeight ? { maxHeight } : undefined}
          className={cn("scrollbar-thin relative overflow-x-auto rounded-chip focus-ring", maxHeight && "overflow-y-auto")}
        >
          <table
            className="zone-ledger w-full border-collapse" data-density={density} style={stack ? undefined : { minWidth }}
            aria-rowcount={pagination?.mode === "server" ? safeCount(pagination.total) || undefined : undefined}
            data-testid={props["data-testid"]}
            {...(stackCls ? { role: "table" } : {})}
          >
            <caption className="sr-only">{caption}</caption>
            <thead {...(stackCls ? { role: "rowgroup" } : {})} className={cn(stack && "max-md:sr-only")}>
              <tr className="border-y border-line" {...(stackCls ? { role: "row" } : {})}>
                {selectable && (
                  <th scope="col" className={cn("w-10 bg-paper-2", stickyHeader && "sticky top-0 z-10")}>
                    <input ref={selectAllRef} type="checkbox" aria-label="Select all rows on this page" checked={allOnPage} onChange={toggleAll} className="size-4 accent-[var(--accent)]" />
                  </th>
                )}
                {visible.map((c) => {
                  const canSort = !!c.sortValue || !!c.sortable;
                  const dir = sort?.id === c.id ? sort.dir : null;
                  const label = c.header;
                  return (
                    <th key={c.id} scope="col"
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : canSort ? "none" : undefined}
                      className={cn("label-caps h-9 whitespace-nowrap bg-paper-2 text-left font-medium", c.align === "right" && "text-right", stickyHeader && "sticky top-0 z-10", c.className)}>
                      {canSort ? (
                        sortHref ? (
                          <Link href={sortHref(c.id, nextDir(c.id))} scroll={false} className={cn("inline-flex items-center gap-1 rounded-chip hover:text-ink focus-ring", dir && "text-ink")}>
                            {label}{dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : dir === "desc" ? <ArrowDown className="size-3" aria-hidden /> : null}
                          </Link>
                        ) : (
                          <button type="button" onClick={() => onSortClick(c.id)} className={cn("inline-flex items-center gap-1 rounded-chip hover:text-ink focus-ring", dir && "text-ink")}>
                            {label}{dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : dir === "desc" ? <ArrowDown className="size-3" aria-hidden /> : null}
                          </button>
                        )
                      ) : label}
                    </th>
                  );
                })}
                {rowActions && <th scope="col" className={cn("w-10 bg-paper-2", stickyHeader && "sticky top-0 z-10")}><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody ref={bodyRef} {...(stackCls ? { role: "rowgroup" } : {})} className={cn(stack && "max-md:block")}>
              {shown.map((row, i) => {
                const id = rowId(row);
                const isSel = sel.has(id);
                return (
                  <tr key={id} data-row aria-selected={selectable ? isSel : undefined}
                    tabIndex={i === active ? 0 : -1}
                    onFocus={() => setActive(i)}
                    onKeyDown={(e) => onRowKey(e, i, row)}
                    {...(stackCls ? { role: "row" } : {})}
                    className={cn(
                      "border-b border-line outline-none last:border-0 hover:bg-paper focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      isSel && "bg-accent-soft/40", onRowActivate && "cursor-pointer",
                      stack && "max-md:flex max-md:h-auto! max-md:min-h-0! max-md:flex-col max-md:gap-1 max-md:px-3 max-md:py-2",
                      rowClassName?.(row),
                    )}>
                    {selectable && (
                      <td className={cn("w-10", stack && "max-md:flex max-md:px-0")} {...(stackCls ? { role: "cell" } : {})}>
                        <input type="checkbox" aria-label={`Select ${labelOf(row)}`} checked={isSel} onChange={() => toggleOne(id)} className="size-4 accent-[var(--accent)]" />
                      </td>
                    )}
                    {visible.map((c) => {
                      const cls = cn(
                        "whitespace-nowrap text-ink", c.align === "right" && "num-mono text-right",
                        stack && "max-md:flex max-md:items-baseline max-md:justify-between max-md:gap-3 max-md:whitespace-normal max-md:px-0 max-md:before:shrink-0 max-md:before:text-12 max-md:before:text-ink-3 max-md:before:content-[attr(data-label)]",
                        stack && c.hideOnStack && "max-md:hidden", c.className,
                      );
                      const common = { className: cls, "data-label": stack ? textLabel(c) : undefined, ...(stackCls ? { role: c.rowHeader ? "rowheader" : "cell" } : {}) };
                      return c.rowHeader
                        ? <th key={c.id} scope="row" {...common} className={cn(cls, "text-left font-medium")}>{c.cell(row)}</th>
                        : <td key={c.id} {...common}>{c.cell(row)}</td>;
                    })}
                    {rowActions && (
                      <td className={cn("w-10 text-right", stack && "max-md:flex max-md:justify-end max-md:px-0")} {...(stackCls ? { role: "cell" } : {})}>
                        <RowMenu row={row} label={labelOf(row)} actions={rowActions(row)} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!showEmpty && pagination && (
        <Pager pagination={pagination} uid={uid} shownCount={shown.length} totalRows={sorted.length} page={page} pageCount={pageCount} clientSize={clientSize} onClientPage={setPage} />
      )}
    </div>
  );
}

function RowMenu<T>({ row, label, actions }: { row: T; label: string; actions: RowAction<T>[] }) {
  if (!actions.length) return null;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" aria-label={`Actions for ${label}`} className="inline-grid size-7 place-items-center rounded-chip text-ink-3 hover:bg-paper-2 hover:text-ink focus-ring">
          <MoreHorizontal className="size-4" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent>
        {actions.map((a) => <MenuItem key={a.key} disabled={a.disabled} onSelect={() => a.onSelect(row)}>{a.label}</MenuItem>)}
      </MenuContent>
    </Menu>
  );
}

function Pager({ pagination, uid, shownCount, totalRows, page, pageCount, clientSize, onClientPage }: {
  pagination: DataGridPagination; uid: string; shownCount: number; totalRows: number; page: number; pageCount: number; clientSize: number; onClientPage: (p: number) => void;
}) {
  const btn = "inline-flex h-8 items-center gap-1 rounded-control border border-line-strong bg-surface px-2.5 text-13 font-medium text-ink hover:bg-paper-2 focus-ring disabled:opacity-45 aria-disabled:opacity-45";
  const step = (dirLabel: "Previous" | "Next", disabled: boolean, onClick?: () => void, href?: string) => {
    const inner = dirLabel === "Previous" ? <><ChevronLeft className="size-4" aria-hidden />Previous</> : <>Next<ChevronRight className="size-4" aria-hidden /></>;
    if (href && !disabled) return <Link href={href} scroll={false} className={btn} rel={dirLabel === "Next" ? "next" : "prev"}>{inner}</Link>;
    return <button type="button" className={btn} disabled={disabled} onClick={onClick}>{inner}</button>;
  };
  let summary = "", prev: ReactNode, next: ReactNode;
  if (pagination.mode === "client") {
    const total = safeCount(totalRows), from = total ? page * clientSize + 1 : 0, to = Math.min(total, page * clientSize + shownCount);
    summary = `${from}-${to} of ${total}`;
    prev = step("Previous", page <= 0, () => onClientPage(page - 1));
    next = step("Next", page >= pageCount - 1, () => onClientPage(page + 1));
  } else if (pagination.mode === "server") {
    const size = Math.max(1, safeCount(pagination.pageSize)), total = safeCount(pagination.total), pg = Math.max(1, safeCount(pagination.page) || 1);
    const last = Math.max(1, Math.ceil(total / size)), from = total ? (pg - 1) * size + 1 : 0, to = Math.min(total, pg * size);
    summary = `${from}-${to} of ${total}`;
    prev = step("Previous", pg <= 1, () => pagination.onPageChange?.(pg - 1), pagination.hrefForPage?.(pg - 1));
    next = step("Next", pg >= last, () => pagination.onPageChange?.(pg + 1), pagination.hrefForPage?.(pg + 1));
  } else {
    summary = `${safeCount(shownCount)} shown`;
    prev = step("Previous", !pagination.hasPrev, pagination.onPrev, pagination.prevHref);
    next = step("Next", !pagination.hasNext, pagination.onNext, pagination.nextHref);
  }
  return (
    <nav aria-label="Pagination" aria-describedby={`${uid}-sum`} className="flex items-center justify-between gap-3 border-t border-line px-3 py-2 sm:px-4">
      <span id={`${uid}-sum`} className="text-12 text-ink-3 num">{summary}</span>
      <span className="flex items-center gap-2">{prev}{next}</span>
    </nav>
  );
}
