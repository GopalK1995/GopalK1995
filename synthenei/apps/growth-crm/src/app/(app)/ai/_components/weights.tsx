"use client";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Gated } from "../../accounts/_components/gated";
import type { Verdict } from "../../accounts/_components/perms";
import { saveWeights } from "../actions";

export type FactorRow = { label: string; weight: number; avg: number; share: number; example: string };
const BANDS = [{ k: "0–39", lo: 0, hi: 39 }, { k: "40–69", lo: 40, hi: 69 }, { k: "70–100", lo: 70, hi: 100 }];
const bandOf = (s: number) => BANDS.findIndex((b) => s >= b.lo && s <= b.hi);

/** Factor weights (max points) with a live "score distribution if saved" preview. Scores are rule-based, not ML. */
export function WeightsEditor({ factors, points, scores, edit }: { factors: FactorRow[]; points: number[][]; scores: number[]; edit: Verdict }) {
  const [w, setW] = useState(factors.map((f) => f.weight));
  const [pending, start] = useTransition();
  const preview = useMemo(() => scores.map((s, i) => {
    const delta = points[i].reduce((a, p, j) => a + (factors[j].weight ? (p * w[j]) / factors[j].weight - p : 0), 0);
    return Math.max(0, Math.min(100, Math.round(s + delta)));
  }), [w, scores, points, factors]);
  const cur = BANDS.map((_, b) => scores.filter((s) => bandOf(s) === b).length);
  const nxt = BANDS.map((_, b) => preview.filter((s) => bandOf(s) === b).length);
  const max = Math.max(1, ...cur, ...nxt);
  const dirty = w.some((v, i) => v !== factors[i].weight);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-[13px]">
          <caption className="sr-only">Lead score factors and weights</caption>
          <thead><tr className="border-y border-line bg-paper/60 text-[11px] uppercase tracking-[0.05em] text-ink-3">
            <th scope="col" className="h-9 px-3 text-left font-medium">Factor</th>
            <th scope="col" className="h-9 px-3 text-right font-medium">Max points</th>
            <th scope="col" className="h-9 px-3 text-right font-medium">Avg earned</th>
            <th scope="col" className="h-9 px-3 text-right font-medium">Leads earning</th>
          </tr></thead>
          <tbody>{factors.map((f, i) => (
            <tr key={f.label} className="border-b border-line last:border-0">
              <td className="px-3 py-2"><div className="font-medium text-ink">{f.label}</div><div className="text-[12px] text-ink-3">{f.example}</div></td>
              <td className="px-3 py-2 text-right">
                {edit.ok ? (
                  <input type="number" min={-40} max={40} value={w[i]} aria-label={`${f.label} max points`} onChange={(e) => setW((x) => x.map((v, j) => (j === i ? Math.max(-40, Math.min(40, Number(e.target.value) || 0)) : v)))}
                    className={cn("h-8 w-16 rounded-sm border bg-surface px-2 text-right text-[13px] outline-none num focus:border-ring", w[i] !== f.weight ? "border-accent" : "border-line-strong")} />
                ) : <span className="num font-medium">{f.weight > 0 ? "+" : ""}{f.weight}</span>}
              </td>
              <td className="px-3 py-2 text-right num text-ink-2">{f.avg.toFixed(1)}</td>
              <td className="px-3 py-2 text-right num text-ink-2">{Math.round(f.share * 100)}%</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="mt-2 text-[12px] text-ink-3">No protected attributes (gender, religion, caste or name-based guesses) are used. Weights are rule-based until 200+ deals have closed.</p>
      </div>

      <div>
        <h3 className="text-[13px] font-semibold text-ink">Score distribution if saved</h3>
        <p className="text-[12px] text-ink-3 num">{scores.length} leads · current vs preview</p>
        <ul className="mt-3 space-y-3">
          {BANDS.map((b, i) => (
            <li key={b.k}>
              <div className="mb-1 flex justify-between text-[12px]"><span className="text-ink-2">Score {b.k}</span><span className="num text-ink">{cur[i]} → <strong className={cn("font-semibold", nxt[i] !== cur[i] && "text-accent")}>{nxt[i]}</strong></span></div>
              <div className="space-y-1" aria-hidden>
                <div className="h-2 rounded-full bg-paper-2"><div className="h-full rounded-full bg-seq-2 transition-[width] duration-200 ease-out" style={{ width: `${(cur[i] / max) * 100}%` }} /></div>
                <div className="h-2 rounded-full bg-paper-2"><div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${(nxt[i] / max) * 100}%` }} /></div>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-3 text-[11px] text-ink-3"><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-seq-2" />Current</span><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-accent" />If saved</span></div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Gated v={edit}><Button size="sm" variant="primary" disabled={!dirty || pending} onClick={() => start(async () => { const r = await saveWeights(factors.map((f, i) => ({ label: f.label, from: f.weight, to: w[i] }))); toast(r.message, r.sub); })}>Save weights</Button></Gated>
          {dirty && <Button size="sm" variant="ghost" onClick={() => setW(factors.map((f) => f.weight))}>Reset</Button>}
        </div>
      </div>
    </div>
  );
}
