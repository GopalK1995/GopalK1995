"use client";
import { useEffect, useState } from "react";
import { RadarCompare } from "@/components/charts/radar";
import { SERIES } from "@/components/charts/kit";
import { cn } from "@/lib/utils";

const AXES = ["Reach", "Engagement", "CTR", "Lead rate", "Cost efficiency"] as const;
export type RadarCampaign = { id: string; label: string; scores: number[]; raw: string[] };

/** M45 reach profile. Pick up to 3 campaigns (2 on phones). A campaign keeps its colour slot while selected, so
 *  colour follows the campaign, never its position. A values table under the chart carries every number. */
export function RadarPicker({ campaigns, initial, height = 360, total }: { campaigns: RadarCampaign[]; initial: string[]; height?: number; total: number }) {
  const campaignCount = total;
  const [slots, setSlots] = useState<(string | null)[]>(() => [initial[0] ?? null, initial[1] ?? null, initial[2] ?? null]);
  const [max, setMax] = useState(3);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setMax(mq.matches ? 2 : 3);
    on(); mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const active = slots.slice(0, max);
  const selected = active.filter(Boolean) as string[];
  const toggle = (id: string) => setSlots((s) => {
    const cur = s.slice(0, max);
    const at = cur.indexOf(id);
    if (at >= 0) { if (selected.length <= 1) return s; const n = [...s]; n[at] = null; return n; }
    const free = cur.indexOf(null);
    const n = [...s];
    if (free >= 0) n[free] = id; else n[max - 1] = id; // replace the last slot when full
    return n;
  });
  const sel = active.map((id, slot) => ({ id, slot })).filter((x): x is { id: string; slot: number } => !!x.id)
    .map(({ id, slot }) => ({ c: campaigns.find((c) => c.id === id)!, slot })).filter((x) => x.c);
  const data = AXES.map((axis, i) => {
    const row: Record<string, number | string> = { axis };
    sel.forEach(({ c }) => { row[c.id] = c.scores[i]; });
    return row;
  });
  const series = sel.map(({ c, slot }) => ({ key: c.id, label: c.label, color: SERIES[slot === 0 ? 0 : slot === 1 ? 1 : 2], dashed: slot > 0 }));
  const summary = sel.map(({ c }) => `${c.label}: ${AXES.map((a, i) => `${a} ${c.scores[i]}`).join(", ")}`).join(". ");
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label={`Campaigns to compare (up to ${max})`}>
        {campaigns.map((c) => {
          const slot = active.indexOf(c.id);
          const on = slot >= 0;
          return (
            <button key={c.id} type="button" onClick={() => toggle(c.id)} aria-pressed={on}
              className={cn("inline-flex min-h-8 items-center gap-1.5 rounded-sm border px-2 text-left text-[12px] transition-colors duration-150", on ? "border-line-strong bg-surface text-ink shadow-1" : "border-transparent bg-paper-2 text-ink-3 hover:text-ink")}>
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: on ? series.find((s) => s.key === c.id)?.color : "var(--line-strong)" }} aria-hidden />{c.label}
            </button>
          );
        })}
      </div>
      <div className="[&_svg]:overflow-visible"><RadarCompare label={`Reach profile radar, 0 to 100 per axis. ${summary}`} data={data} series={series} height={height} /></div>
      <div className="scrollbar-thin mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <caption className="sr-only">Reach profile scores (0–100, position among campaigns; best = 100) with the underlying value</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-1.5 pr-2 text-left text-[11px] font-medium uppercase tracking-[0.05em] text-ink-3">Axis</th>
              {series.map((s) => (
                <th key={s.key} scope="col" className="py-1.5 pl-2 text-right align-bottom text-[11px] font-medium text-ink-2">
                  <span className="inline-flex items-center justify-end gap-1.5"><svg className="shrink-0" width="14" height="8" aria-hidden><line x1="0" x2="14" y1="4" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "3 2" : undefined} /></svg><span>{s.label}</span></span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {AXES.map((a, i) => (
              <tr key={a} className="border-b border-line last:border-0">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink-2">{a}</th>
                {sel.map(({ c }) => (
                  <td key={c.id} className="py-1.5 pl-2 text-right num">
                    <span className="font-semibold text-ink">{c.scores[i]}</span>{c.raw[i] && <span className="block text-[11px] text-ink-3 sm:ml-1.5 sm:inline sm:text-[12px]">{c.raw[i]}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-ink-3">Score = position among {campaignCount} campaigns in this workspace over the period (best = 100). Grey figures are the real values. Cost efficiency ranks cost per lead, lowest first; email with no media spend ranks best.</p>
    </div>
  );
}
