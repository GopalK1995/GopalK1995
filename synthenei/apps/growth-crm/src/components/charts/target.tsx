"use client";
import { cn } from "@/lib/utils";
import { FMT, type Fmt } from "./kit";

/** Bullet bar: achieved vs target with a pace tick (expected by today). */
export function TargetBar({ value, target, pace, label, format, className, tone = "light" }: { value: number; target: number; pace: number; label: string; format: Fmt; className?: string; tone?: "light" | "navy" }) {
  const f = FMT[format];
  const w = Math.min(1, value / target) * 100, p = Math.min(1, pace) * 100;
  const ahead = value / target >= pace;
  const navy = tone === "navy";
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px]">
        <span className={navy ? "text-navy-ink-2" : "text-ink-2"}>{label}</span>
        <span className="num"><span className={cn("font-semibold", navy ? "text-navy-ink" : "text-ink")}>{f(value)}</span><span className={navy ? "text-navy-ink-3" : "text-ink-3"}> / {f(target)}</span></span>
      </div>
      <div className={cn("relative h-2.5 rounded-full", navy ? "bg-navy-800" : "bg-paper-2")} role="meter" aria-valuenow={value} aria-valuemax={target} aria-label={label}>
        <div className={cn("grow-x absolute inset-y-0 left-0 rounded-full", navy ? "bg-accent-on-navy" : "bg-accent")} style={{ width: `${w}%` }} />
        <div className={cn("absolute -top-1 h-[18px] w-0.5 rounded-full", navy ? "bg-navy-ink" : "bg-ink")} style={{ left: `calc(${p}% - 1px)` }} title="Expected by today" />
      </div>
      <div className={cn("mt-1.5 text-[11px]", navy ? "text-navy-ink-3" : "text-ink-3")}>
        {Math.round((value / target) * 100)}% achieved · pace tick = {Math.round(pace * 100)}% of month gone · <span className={ahead ? (navy ? "text-[oklch(0.8_0.12_155)]" : "text-success") : navy ? "text-[oklch(0.82_0.12_75)]" : "text-warn-ink"}>{ahead ? "ahead of pace" : "behind pace"}</span>
      </div>
    </div>
  );
}
