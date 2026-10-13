"use client";
import { useId } from "react";
import { cn } from "@/lib/utils";

/** Tiny trend line for KPI tiles. Decorative: the tile's number carries the value (aria-hidden). */
export function Sparkline({ data, className, tone = "light" }: { data: number[]; className?: string; tone?: "light" | "navy" }) {
  const id = useId();
  const W = 96, H = 36, p = 3;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => [p + (i / (data.length - 1)) * (W - 2 * p), H - p - ((v - min) / span) * (H - 2 * p)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const stroke = tone === "navy" ? "var(--accent-on-navy)" : "var(--chart-1)";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("overflow-visible", className)} aria-hidden preserveAspectRatio="none">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={stroke} stopOpacity="0.14" /><stop offset="1" stopColor={stroke} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${last[0]},${H} L${pts[0][0]},${H} Z`} fill={`url(#${id})`} />
      <path className="draw-in" pathLength={1} d={d} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={stroke} stroke={tone === "navy" ? "var(--navy-900)" : "var(--surface)"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
