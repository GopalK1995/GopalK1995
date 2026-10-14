// Responsive data table: a real <table> from 768px up, stacked cards below (title, two facts, one action).
// Server-compatible (no hooks), so cell renderers can be plain functions from server components.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Empty, th, thNum, td, tdNum } from "./misc";

export type Column<T> = {
  key: string; header: ReactNode; cell: (row: T) => ReactNode; align?: "left" | "right"; className?: string;
  /** Role on the mobile card. Columns without one are hidden on mobile. */
  mobile?: "title" | "fact" | "action";
};
export function DataTable<T>({ rows, columns, rowKey, minWidth = 720, empty = "Nothing here yet.", emptyHint, caption, rowClassName }: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; minWidth?: number; empty?: string; emptyHint?: ReactNode; caption?: string; rowClassName?: (r: T) => string;
}) {
  if (!rows.length) return <div className="p-4"><Empty title={empty}>{emptyHint}</Empty></div>;
  const title = columns.find((c) => c.mobile === "title"), facts = columns.filter((c) => c.mobile === "fact").slice(0, 2), action = columns.find((c) => c.mobile === "action");
  return (
    <>
      <div className="scrollbar-thin relative hidden overflow-x-auto md:block">
        <table className="w-full border-collapse" style={{ minWidth }}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead><tr className="border-y border-line bg-paper/60">{columns.map((c) => <th key={c.key} scope="col" className={cn(c.align === "right" ? thNum : th, c.className)}>{c.header}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className={cn("border-b border-line last:border-0 hover:bg-paper/60", rowClassName?.(r))}>
                {columns.map((c) => <td key={c.key} className={cn(c.align === "right" ? tdNum : td, c.className)}>{c.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-line border-t border-line md:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              {title && <div className="truncate text-[13px] font-medium text-ink">{title.cell(r)}</div>}
              {facts.length > 0 && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3 num">{facts.map((f, i) => <span key={f.key} className="inline-flex items-center gap-1">{i > 0 && <span aria-hidden>·</span>}{f.cell(r)}</span>)}</div>}
            </div>
            {action && <div className="shrink-0 text-[12px]">{action.cell(r)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
