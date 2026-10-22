"use client";
import { useState } from "react";
import { HBar } from "@/components/charts/hbar";
import { Segmented } from "@/components/ui/tabs";
import { pct } from "@/lib/format";
import { useVocab } from "@/components/shell/providers";

type Row = { ch: string; label: string; leads: number; demos: number; won: number };

/** First vs last touch (spec: only these two; multi-touch is noise at our volume). Bars = leads; table = demos, won. */
export function AttributionPanel({ first, last }: { first: Row[]; last: Row[] }) {
  const [m, setM] = useState<"first" | "last">("first");
  const rows = m === "first" ? first : last;
  const other = m === "first" ? last : first;
  const t = useVocab().an.att;
  const total = rows.reduce((a, r) => a + r.leads, 0);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Attribution model" options={[{ value: "first", label: "First touch" }, { value: "last", label: "Last touch" }]} value={m} onChange={setM} />
        <span className="text-[12px] text-ink-3">{m === "first" ? t.first : t.last}</span>
      </div>
      <HBar label={`${t.bars}, ${m} touch. ${rows.map((r) => `${r.label} ${r.leads}`).join(", ")}`} data={rows.map((r) => ({ label: r.label, value: r.leads, note: t.note(r.demos, r.won) }))} highlight={rows[0]?.label} labelWidth={92} valueLabel={t.leads} />
      <div className="scrollbar-thin mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-[12px]">
          <caption className="sr-only">{t.cap} {m}-touch attribution, with change vs the other model</caption>
          <thead><tr className="border-b border-line text-[11px] uppercase tracking-[0.05em] text-ink-3">
            <th scope="col" className="py-1.5 text-left font-medium">Channel</th><th scope="col" className="py-1.5 text-right font-medium">{t.leads}</th><th scope="col" className="py-1.5 text-right font-medium">{t.demos}</th><th scope="col" className="py-1.5 text-right font-medium">{t.won}</th><th scope="col" className="py-1.5 pl-2 text-right font-medium">vs {m === "first" ? "last" : "first"}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => {
              const o = other.find((x) => x.ch === r.ch)?.leads ?? 0;
              const d = r.leads - o;
              return (
                <tr key={r.ch} className="border-b border-line last:border-0">
                  <th scope="row" className="py-1.5 text-left font-normal text-ink-2">{r.label}</th>
                  <td className="py-1.5 text-right num text-ink">{r.leads}<span className="ml-1 text-ink-3">{pct(r.leads / (total || 1), 0)}</span></td>
                  <td className="py-1.5 text-right num text-ink">{r.demos}</td>
                  <td className="py-1.5 text-right num text-ink">{r.won}</td>
                  <td className="py-1.5 pl-2 text-right num text-ink-3">{d === 0 ? "0" : d > 0 ? `+${d}` : `−${-d}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
