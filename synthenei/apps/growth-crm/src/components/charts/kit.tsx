"use client";
import { useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Fixed categorical order (validated; see tokens.css). Assign by entity, never by rank. */
export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"] as const;
export const OTHER = "var(--chart-other)";
export const ANIM_MS = 280;
export function useChartAnim() {
  const reduce = useReducedMotion();
  return { isAnimationActive: !reduce, animationDuration: ANIM_MS, animationEasing: "ease-out" as const };
}
export const axisProps = { tickLine: false, axisLine: false, tick: { fontSize: 11, fill: "var(--ink-3)" } } as const;

type Row = { name: ReactNode; value: ReactNode; color?: string; dash?: boolean };
export function TooltipBox({ title, rows }: { title?: ReactNode; rows: Row[] }) {
  return (
    <div className="min-w-36 rounded-sm border border-line bg-surface px-3 py-2 text-[12px] shadow-pop">
      {title && <div className="mb-1.5 font-medium text-ink">{title}</div>}
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              {r.color && <span className={cn("inline-block h-2 w-2 rounded-[2px]", r.dash && "h-0.5 w-3 rounded-none")} style={{ background: r.color }} />}
              {r.name}
            </span>
            <span className="font-medium text-ink num">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Legend({ items, className }: { items: { label: string; color: string; shape?: "dot" | "line" | "dash" }[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2", className)}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          {it.shape === "line" || it.shape === "dash" ? (
            <svg width="14" height="8" aria-hidden><line x1="0" x2="14" y1="4" y2="4" stroke={it.color} strokeWidth="2" strokeDasharray={it.shape === "dash" ? "3 2" : undefined} /></svg>
          ) : <span className="inline-block size-2.5 rounded-[2px]" style={{ background: it.color }} aria-hidden />}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/** Wrapper that gives every chart an accessible name and a fixed height (no layout shift). */
export function ChartFrame({ label, height, children, className }: { label: string; height: number; children: ReactNode; className?: string }) {
  return <figure role="img" aria-label={label} className={cn("w-full min-w-0", className)} style={{ height }}>{children}</figure>;
}

import { inr, inrCompact, num, numCompact, pct } from "@/lib/format";
/** Format keys (functions cannot cross the server/client boundary, so charts take a key). */
export type Fmt = "num" | "numCompact" | "inr" | "inrCompact" | "pct" | "pct0" | "score";
export const FMT: Record<Fmt, (n: number) => string> = {
  num, numCompact, inr, inrCompact, pct: (n) => pct(n, 1), pct0: (n) => pct(n, 0), score: (n) => `${Math.round(n)}`,
};
