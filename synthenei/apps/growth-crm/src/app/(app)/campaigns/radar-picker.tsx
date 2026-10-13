"use client";
import { useState } from "react";
import { RadarCompare } from "@/components/charts/radar";
import { SERIES } from "@/components/charts/kit";
import { cn } from "@/lib/utils";

/** Pick 2–3 campaigns to overlay. Colour follows the campaign (its fixed slot), never its rank. */
export function RadarPicker({ data, campaigns, initial }: { data: Record<string, number | string>[]; campaigns: { id: string; label: string; slot: number }[]; initial: string[] }) {
  const [sel, setSel] = useState<string[]>(initial);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? (s.length > 2 ? s.filter((x) => x !== id) : s) : s.length >= 3 ? [...s.slice(1), id] : [...s, id]));
  const series = campaigns.filter((c) => sel.includes(c.id)).map((c, i) => ({ key: c.id, label: c.label, color: SERIES[c.slot % SERIES.length], dashed: i > 0 }));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Campaigns to compare (2 to 3)">
        {campaigns.map((c) => {
          const on = sel.includes(c.id);
          return (
            <button key={c.id} onClick={() => toggle(c.id)} aria-pressed={on}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[12px] transition-colors", on ? "border-line-strong bg-surface text-ink shadow-1" : "border-transparent bg-paper-2 text-ink-3 hover:text-ink")}>
              <span className="size-2 rounded-[2px]" style={{ background: on ? SERIES[c.slot % SERIES.length] : "var(--line-strong)" }} />{c.label}
            </button>
          );
        })}
      </div>
      <RadarCompare label="Campaign reach profile on five normalised axes" data={data} series={series} height={300} />
      <p className="mt-2 text-[11px] text-ink-3">Each axis is scaled 0–100 against the best campaign on that axis. Cost efficiency = 1 / cost per lead.</p>
    </div>
  );
}
