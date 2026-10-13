"use client";
import { motion, useReducedMotion } from "motion/react";
import { num, pct } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Horizontal funnel: bar width = share of step 1, step conversion beside each bar; biggest drop flagged. */
export function Funnel({ steps, className, lowN = 20 }: { steps: { key: string; label: string; n: number; step: number; cum: number }[]; className?: string; lowN?: number }) {
  const reduce = useReducedMotion();
  const max = steps[0]?.n || 1;
  const drops = steps.slice(1).map((s, i) => ({ i: i + 1, drop: 1 - s.step }));
  const worst = drops.filter((d) => d.i >= 3).sort((a, b) => b.drop - a.drop)[0]?.i;
  return (
    <ol className={cn("space-y-1.5", className)}>
      {steps.map((s, i) => {
        const w = Math.max(1.5, Math.sqrt(s.n / max) * 100); // sqrt scale keeps late steps visible; exact numbers shown
        return (
          <li key={s.key} className="grid grid-cols-[minmax(104px,132px)_1fr_auto] items-center gap-3">
            <span className="truncate text-[12px] text-ink-2">{s.label}</span>
            <div className="relative h-6 rounded-[4px] bg-paper-2">
              <motion.div className={cn("absolute inset-y-0 left-0 rounded-[4px]", i < 3 ? "bg-seq-2" : "bg-accent")}
                initial={reduce ? false : { width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.28, delay: reduce ? 0 : i * 0.03, ease: [0.22, 1, 0.36, 1] }} />
              <span className="absolute inset-y-0 flex items-center text-[12px] font-semibold num text-ink" style={w > 30 ? { left: 8, color: i >= 3 ? "var(--accent-ink)" : "var(--ink)" } : { left: `calc(${w}% + 6px)` }}>{num(s.n)}</span>
            </div>
            <span className={cn("w-[88px] text-right text-[12px] num", worst === i ? "font-semibold text-danger" : "text-ink-3")}>
              {i === 0 ? "—" : pct(s.step, 1)}{i > 0 && s.n < lowN && i > 2 ? <span className="ml-1 text-[10px] text-ink-3">low n</span> : null}
            </span>
          </li>
        );
      })}
      <li className="pt-1 text-[11px] text-ink-3">Grey steps are consented web visitors (under-count vs GA4). Right column: conversion from the previous step; red marks the biggest drop after lead capture.</li>
    </ol>
  );
}
