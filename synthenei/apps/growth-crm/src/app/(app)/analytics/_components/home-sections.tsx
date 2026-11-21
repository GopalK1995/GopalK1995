// Server-rendered sections of the home dashboard. Pure presentation over the read model in ../_lib/home.ts.
import Link from "next/link";
import { ArrowRight, CalendarClock, CalendarX, CheckCircle2, FileClock, ListChecks, UserX } from "lucide-react";
import { inr, inrCompact, num, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Decision, FlowStage, PaidOrganic, Ruler } from "../_lib/home";

export type T = (key: string, values?: Record<string, string | number>) => string;
const ICON = { unanswered: UserX, slipped: CalendarX, stale: FileClock, closing: CalendarClock, overdue: ListChecks } as const;

/** Decision zone: the page's first and densest-padded region. One readout (gap to target) and the things to act on today. */
export function DecisionZone({ t, ruler, items, slaHours, links, settingsHref }: {
  t: T; ruler: Ruler; items: Decision[]; slaHours: number; /** false for viewers: they see counts, not links into records they cannot open. */ links: boolean; settingsHref: string | null;
}) {
  const met = ruler.gap === 0;
  return (
    <section aria-labelledby="dz-title" data-zone="decision" className="grid overflow-hidden rounded-control border border-line-strong bg-surface lg:grid-cols-12">
      <div className="p-5 sm:p-6 lg:col-span-5 lg:border-r lg:border-line">
        {ruler.target === null ? (
          <>
            <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-ink-3">{t("gapLabel")}</div>
            <div className="num-mono mt-1 text-[26px] font-semibold leading-8 text-ink-3">{t("noTargetTitle")}</div>
            <p className="mt-2 text-[13px] leading-5 text-ink-2">{t("noTargetBody", { won: inr(ruler.won) })}</p>
            {settingsHref && <Link href={settingsHref} className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">{t("setTarget")}<ArrowRight className="size-3.5" aria-hidden /></Link>}
          </>
        ) : (
          <>
            <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-ink-3">{met ? t("gapMet") : t("gapLabel")}</div>
            <div className="num-mono mt-1 text-[26px] font-semibold leading-8" data-testid="gap">{met ? inr(ruler.won) : inr(ruler.gap ?? 0)}</div>
            <p className="mt-2 text-[13px] leading-5 text-ink-2">{met ? t("gapMetBody", { won: inr(ruler.won), target: inr(ruler.target) }) : t("gapBody", { won: inr(ruler.won), target: inr(ruler.target), count: ruler.wonCount })}</p>
            {ruler.perDayNeeded !== null && <p className="mt-1.5 text-[13px] leading-5 text-ink-2">{t("perDay", { value: inr(ruler.perDayNeeded), days: ruler.days - ruler.today })}</p>}
            <p className="mt-1.5 text-[13px] leading-5 text-ink-2">{ruler.weightedRest > 0 && ruler.projectedPct !== null ? t("forecast", { value: inr(ruler.forecastEnd), pct: pct(ruler.projectedPct, 0) }) : t("forecastNone")}</p>
          </>
        )}
        {ruler.slipped.count > 0 && <p className="mt-3 border-t border-line pt-3 text-[12px] leading-4 text-ink-3">{t("slipped", { count: ruler.slipped.count, value: inrCompact(ruler.slipped.value) })}</p>}
      </div>
      <div className="p-5 sm:p-6 lg:col-span-7">
        <h2 id="dz-title" className="text-[15px] font-bold tracking-[-0.015em] text-ink">{t("decisionTitle")}</h2>
        {items.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-ink-2"><CheckCircle2 className="size-4 text-success" aria-hidden />{t("allClear")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {items.slice(0, 5).map((d) => {
              const Icon = ICON[d.id];
              const body = <>
                <Icon className={cn("size-4 shrink-0", d.id === "unanswered" || d.id === "slipped" ? "text-danger" : "text-warn")} aria-hidden />
                <span className="min-w-0 flex-1 text-[13px] leading-5 text-ink">{t(`d_${d.id}`, { count: d.count, hours: slaHours, value: inrCompact(d.value ?? 0) })}</span>
              </>;
              return (
                <li key={d.id} data-decision={d.id}>
                  {links ? (
                    <Link href={d.href} className="group flex items-center gap-3 py-2.5 hover:bg-paper-2">
                      {body}<span className="flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent">{t("open")}<ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
                    </Link>
                  ) : <div className="flex items-center gap-3 py-2.5">{body}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Open value by stage as rules and ticks: bar length = value, one tick per deal, red ticks are past the stage SLA. */
export function StageFlow({ t, stages }: { t: T; stages: FlowStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  if (!stages.some((s) => s.count > 0)) return <p className="text-[13px] text-ink-3">{t("flowEmpty")}</p>;
  return (
    <ol aria-label={t("flowAria")} className="divide-y divide-line border-y border-line">
      {stages.map((s) => (
        <li key={s.key} data-stage={s.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 py-2.5">
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[12px] font-semibold text-ink">{s.label}</span><span className="num-mono shrink-0 text-[12px] text-ink-2">{t("flowDeals", { count: s.count })}</span></div>
            <div className="mt-1.5 h-2 rounded-bar bg-paper-2"><div className="h-full rounded-bar bg-chart-1" style={{ width: `${Math.max(s.value > 0 ? 2 : 0, (s.value / max) * 100)}%` }} /></div>
            {s.count > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-px" aria-hidden>
                {Array.from({ length: Math.min(s.count, 40) }, (_, i) => <span key={i} className={cn("h-3 w-1 rounded-bar", i < s.stale ? "bg-danger" : "bg-line-strong")} />)}
              </div>
            )}
          </div>
          <div className="text-right"><div className="num-mono text-[13px] font-semibold text-ink">{inrCompact(s.value)}</div>
            <div className="num-mono text-[12px] text-ink-3">{t("flowWeighted", { value: inrCompact(s.weighted) })}</div>
            {s.stale > 0 && <div className="text-[12px] font-medium text-danger">{t("flowStale", { count: s.stale })}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

const FMTS = { num, inr, pct: (n: number) => pct(n, 1) } as const;
/** Paid and organic columns, same measures. Null = No data (a word, never 0); "na" = the measure does not exist for that side. */
export function PaidOrganicTable({ t, data }: { t: T; data: PaidOrganic }) {
  const show = (v: number | null | "na", f: keyof typeof FMTS) => v === "na" ? <span className="text-ink-3">{t("notApplicable")}</span> : v === null ? <span className="text-ink-3">{t("noData")}</span> : FMTS[f](v);
  return (
    <table className="w-full border-collapse text-[12px]">
      <caption className="sr-only">{t("pvoTitle")}</caption>
      <thead><tr className="border-b border-line text-ink-3">
        <th scope="col" className="h-8 text-left font-medium">{t("metric")}</th>
        <th scope="col" className="h-8 text-right font-medium">{t("paid")}</th>
        <th scope="col" className="h-8 text-right font-medium">{t("organic")}</th>
      </tr></thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={r.key} data-row={r.key} className="h-9 border-b border-line last:border-0">
            <th scope="row" className="text-left font-normal text-ink-2">{t(`r_${r.key}`)}</th>
            <td className="num-mono text-right text-ink" data-side="paid">{show(r.paid, r.format)}</td>
            <td className="num-mono text-right text-ink" data-side="organic">{show(r.organic, r.format)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
