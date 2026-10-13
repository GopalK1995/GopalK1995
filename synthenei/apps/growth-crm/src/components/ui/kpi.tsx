"use client";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CountUp } from "./motion";
import { Sparkline } from "../charts/sparkline";
import { inr, inrCompact, num, pct, minsToHuman } from "@/lib/format";

export type KpiFormat = "inr" | "inrCompact" | "num" | "pct" | "mins";
const F: Record<KpiFormat, (n: number) => string> = { inr, inrCompact, num, pct: (n) => pct(n), mins: minsToHuman };

export function Kpi({
  label, value, format = "num", delta, deltaLabel, goodWhen = "up", spark, foot, className, tone = "light", metric,
}: {
  label: string; value: number; format?: KpiFormat; delta?: number; deltaLabel?: string; goodWhen?: "up" | "down";
  spark?: number[]; foot?: ReactNode; className?: string; tone?: "light" | "navy"; metric?: string;
}) {
  const dir = delta === undefined || !Number.isFinite(delta) || Math.abs(delta) < 0.005 ? 0 : delta > 0 ? 1 : -1;
  const good = dir === 0 ? null : (dir > 0) === (goodWhen === "up");
  const Icon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus;
  const navy = tone === "navy";
  return (
    <div className={cn("flex min-w-0 flex-col justify-between gap-3 rounded-md border p-4", navy ? "border-navy-line bg-navy-900 text-navy-ink" : "border-line bg-surface shadow-1", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className={cn("text-[12px] font-medium leading-4", navy ? "text-navy-ink-2" : "text-ink-2")} title={metric ? `Metric ${metric} (product spec, section 6)` : undefined}>{label}</span>
        
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <CountUp value={value} format={F[format]} className="block text-[26px] font-semibold leading-8 tracking-[-0.02em]" />
          {delta !== undefined && (
            <div className="mt-1 flex items-center gap-1 text-[12px] leading-4">
              <span className={cn("inline-flex items-center gap-0.5 font-medium num", good === null ? (navy ? "text-navy-ink-2" : "text-ink-3") : good ? (navy ? "text-[oklch(0.8_0.12_155)]" : "text-success") : navy ? "text-[oklch(0.78_0.13_30)]" : "text-danger")}>
                <Icon className="size-3.5" aria-hidden />{Number.isFinite(delta) ? `${Math.abs(delta * 100).toFixed(1)}%` : "–"}
              </span>
              <span className={navy ? "text-navy-ink-3" : "text-ink-3"}>{deltaLabel ?? "vs prev. period"}</span>
            </div>
          )}
        </div>
        {spark && spark.length > 1 && <Sparkline data={spark} className="h-9 w-24 shrink-0" tone={navy ? "navy" : "light"} />}
      </div>
      {foot && <div className={cn("border-t pt-2 text-[12px] leading-4", navy ? "border-navy-line text-navy-ink-3" : "border-line text-ink-3")}>{foot}</div>}
    </div>
  );
}
