"use client";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Sparkline } from "../charts/sparkline";
import { inr, inrCompact, num, pct, minsToHuman } from "@/lib/format";

export type KpiFormat = "inr" | "inrCompact" | "num" | "pct" | "mins";
const F: Record<KpiFormat, (n: number) => string> = { inr, inrCompact, num, pct: (n) => pct(n), mins: minsToHuman };
/** A missing reading is shown as this word, never as 0. */
export const NO_DATA = "No data";
export const showValue = (v: number | null | undefined, f: KpiFormat, noData = NO_DATA) => (v === null || v === undefined || !Number.isFinite(v) ? noData : F[f](v));

/** Direction and text for a delta fraction. Non-finite (missing/zero baseline) -> no direction and "No prior period". */
export const NO_PRIOR = "No prior period";
export function deltaView(delta: number | null | undefined): { dir: -1 | 0 | 1; text: string; word: "up" | "down" | "" } | null {
  if (delta === undefined || delta === null) return null;
  if (!Number.isFinite(delta)) return { dir: 0, text: NO_PRIOR, word: "" };
  const dir = Math.abs(delta) < 0.005 ? 0 : delta > 0 ? 1 : -1;
  return { dir, text: `${Math.abs(delta * 100).toFixed(1)}%`, word: dir > 0 ? "up" : dir < 0 ? "down" : "" };
}

export function Kpi({
  label, value, format = "num", delta, deltaLabel, goodWhen = "up", spark, foot, className, tone = "light", metric,
}: {
  label: string; value: number | null; format?: KpiFormat; delta?: number; deltaLabel?: string; goodWhen?: "up" | "down";
  spark?: number[]; foot?: ReactNode; className?: string; tone?: "light" | "navy"; metric?: string;
}) {
  const dv = deltaView(delta);
  const noPrior = dv !== null && dv.text === NO_PRIOR;
  const dir = dv?.dir ?? 0;
  const good = dir === 0 ? null : (dir > 0) === (goodWhen === "up");
  const Icon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus;
  const navy = tone === "navy";
  return (
    <div className={cn("flex min-w-0 flex-col justify-between gap-3 rounded-md border p-4", navy ? "border-navy-line bg-navy-900 text-navy-ink" : "border-line bg-surface", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className={cn("text-[12px] font-medium leading-4", navy ? "text-navy-ink-2" : "text-ink-2")} title={metric ? `Metric ${metric} (product spec, section 6)` : undefined}>{label}</span>
        
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <span className={cn("num-mono block text-[26px] font-semibold leading-8", value === null || !Number.isFinite(value) ? "text-ink-3" : null)}>{showValue(value, format)}</span>
          {dv && noPrior && <div className="mt-1 text-[12px] leading-4 text-ink-3">{NO_PRIOR}</div>}
          {dv && !noPrior && (
            <div className="mt-1 flex items-center gap-1 text-[12px] leading-4">
              <span className={cn("inline-flex items-center gap-0.5 font-medium num", good === null ? (navy ? "text-navy-ink-2" : "text-ink-3") : good ? (navy ? "text-[oklch(0.8_0.12_155)]" : "text-success") : navy ? "text-[oklch(0.78_0.13_30)]" : "text-danger")}>
                <Icon className="size-3.5" aria-hidden />{dv.text}<span className="sr-only">{dv.word ? ` ${dv.word}` : ""}</span>
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

export interface LedgerTile { id: string; label: string; value: number | null; format: KpiFormat; foot?: ReactNode; delta?: number; goodWhen?: "up" | "down"; deltaLabel?: string }
/**
 * The configured headline readings (tenant_config.dashboard.kpiTiles) as one ruled row: labels above, mono numbers, hairlines
 * between. Deliberately not four same-size cards. `noData` is the localised word for a missing reading.
 */
export function KpiLedger({ tiles, noData = NO_DATA, label }: { tiles: LedgerTile[]; noData?: string; label: string }) {
  return (
    <dl aria-label={label} className="grid grid-cols-2 border-y border-line lg:grid-cols-4">
      {tiles.map((t, i) => {
        const missing = t.value === null || !Number.isFinite(t.value);
        const d = t.delta;
        const dir = deltaView(d)?.dir ?? 0;
        const good = dir === 0 ? null : (dir > 0) === ((t.goodWhen ?? "up") === "up");
        return (
          <div key={t.id} data-tile={t.id} className={cn("min-w-0 px-4 py-3", i > 0 && "lg:border-l lg:border-line", i % 2 === 1 && "border-l border-line lg:border-l", i >= 2 && "border-t border-line lg:border-t-0")}>
            <dt className="text-[12px] font-medium uppercase tracking-[0.14em] text-ink-3">{t.label}</dt>
            <dd className="mt-1">
              <span className={cn("num-mono text-[22px] font-bold leading-7", missing && "text-ink-3")}>{missing ? noData : F[t.format](t.value as number)}</span>
              {!missing && d !== undefined && Number.isFinite(d) && (
                <span className={cn("ml-2 inline-flex items-center gap-0.5 text-[12px] font-medium num-mono", good === null ? "text-ink-3" : good ? "text-success" : "text-danger")}>
                  {dir > 0 ? <ArrowUpRight className="size-3" aria-hidden /> : dir < 0 ? <ArrowDownRight className="size-3" aria-hidden /> : <Minus className="size-3" aria-hidden />}
                  {Math.abs(d * 100).toFixed(1)}%<span className="sr-only">{dir > 0 ? " up" : dir < 0 ? " down" : ""}</span>
                </span>
              )}
              {t.foot && <div className="mt-0.5 text-[12px] leading-4 text-ink-3">{t.foot}</div>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
