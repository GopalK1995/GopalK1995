"use client";
import { useId, useState, type ReactNode } from "react";
import { FMT, type Fmt } from "./kit";
import { cn } from "@/lib/utils";

export type TableColumn = { key: string; header: string; format?: Fmt; align?: "left" | "right" };
export type TableRow = Record<string, string | number | null | undefined>;
export interface ChartTableLabels { chart: string; table: string; toggle: string; noData: string }
export const DEFAULT_CHART_TABLE_LABELS: ChartTableLabels = { chart: "Chart", table: "Table", toggle: "Show as", noData: "No data" };

/** A missing value is never rendered as 0. Shared by the chart table and the tooltips of the dashboard charts. */
export function cell(v: string | number | null | undefined, format: Fmt | undefined, noData: string): string {
  if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return noData;
  if (typeof v === "string") return v;
  return format ? FMT[format](v) : String(v);
}

/**
 * Every chart on the dashboard sits in this wrapper: a two-state toggle (chart or table), the table being the accessible
 * equivalent of the chart (real <table>, caption, scoped headers). Only one view renders at a time, so a screen reader never
 * reads both. Strings come in as props (client component, no i18n lookup).
 */
export function ChartWithTable({ caption, columns, rows, children, labels = DEFAULT_CHART_TABLE_LABELS, defaultView = "chart", className }: {
  caption: string; columns: TableColumn[]; rows: TableRow[]; children: ReactNode; labels?: ChartTableLabels; defaultView?: "chart" | "table"; className?: string;
}) {
  const [view, setView] = useState<"chart" | "table">(defaultView);
  const id = useId();
  const opts = [{ v: "chart" as const, l: labels.chart }, { v: "table" as const, l: labels.table }];
  return (
    <div className={className}>
      <div className="mb-2 flex justify-end">
        <div role="group" aria-label={labels.toggle} className="inline-flex h-7 items-center rounded-chip border border-line-strong bg-paper-2 p-0.5">
          {opts.map((o) => (
            <button key={o.v} type="button" aria-pressed={view === o.v} aria-controls={`${id}-panel`} onClick={() => setView(o.v)}
              className={cn("h-full rounded-bar px-2 text-[12px] font-medium", view === o.v ? "bg-surface text-ink" : "text-ink-3 hover:text-ink")}>{o.l}</button>
          ))}
        </div>
      </div>
      <div id={`${id}-panel`}>
        {view === "chart" ? children : (
          <div className="scrollbar-thin max-h-[320px] overflow-auto">
            <table className="w-full border-collapse text-[12px]">
              <caption className="sr-only">{caption}</caption>
              <thead>
                <tr className="border-b border-line text-ink-3">
                  {columns.map((c, i) => <th key={c.key} scope="col" className={cn("sticky top-0 bg-surface py-1.5 font-medium", i === 0 || c.align === "left" ? "text-left" : "text-right")}>{c.header}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, ri) => (
                  <tr key={ri} className="h-9 border-b border-line last:border-0">
                    {columns.map((c, i) => {
                      const text = cell(r[c.key], c.format, labels.noData);
                      const missing = text === labels.noData && r[c.key] !== labels.noData;
                      return i === 0
                        ? <th key={c.key} scope="row" className="text-left font-normal text-ink-2">{text}</th>
                        : <td key={c.key} className={cn("num-mono", c.align === "left" ? "text-left" : "text-right", missing ? "text-ink-3" : "text-ink")}>{text}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
