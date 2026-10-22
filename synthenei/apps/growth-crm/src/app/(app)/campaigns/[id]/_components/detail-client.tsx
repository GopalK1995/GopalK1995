"use client";
import { useState, useTransition } from "react";
import { motion, useReducedMotion } from "motion/react";
import { StickyNote } from "lucide-react";
import { LineTrend } from "@/components/charts/line-trend";
import { Segmented } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { inr, num, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { addCampaignNote } from "../../_actions";
import { MktGate, notify } from "../../_components/action";
import { useVocab } from "@/components/shell/providers";
import { localize } from "@/lib/vertical";

type Day = { date: string; spend: number; clicks: number; leads: number };
const PERIODS = [{ value: "30", label: "30 days" }, { value: "60", label: "60 days" }, { value: "90", label: "90 days" }] as const;

/** Spend and leads share a time axis but not a unit, so they are two aligned charts (no dual axis). */
export function TrendPanel({ days, name }: { days: Day[]; name: string }) {
  const vv = useVocab(), L = (x: string) => localize(vv, x);
  const [p, setP] = useState<"30" | "60" | "90">(days.length > 45 ? "60" : "30");
  const xs = days.slice(-Number(p));
  const withAvg = xs.map((d, i) => ({ ...d, avg: Math.round((xs.slice(Math.max(0, i - 6), i + 1).reduce((a, x) => a + x.leads, 0) / Math.min(7, i + 1)) * 10) / 10 }));
  const spend = xs.reduce((a, d) => a + d.spend, 0), leads = xs.reduce((a, d) => a + d.leads, 0);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-ink-3 num">{inr(spend)} spent · {num(leads)} CRM {L("leads")} in the last {p} days{days.length < Number(p) ? ` (campaign ran ${days.length} days)` : ""}</p>
        <Segmented label="Trend period" options={[...PERIODS]} value={p} onChange={setP} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[12px] font-medium text-ink-2">Spend per day (₹)</h3>
          <LineTrend label={`${name}: daily spend over the last ${p} days`} data={xs} series={[{ key: "spend", label: "Spend", color: "var(--chart-1)", area: true }]} yFormat="inrCompact" height={200} />
        </div>
        <div>
          <h3 className="mb-2 text-[12px] font-medium text-ink-2">CRM {L("leads")} per day</h3>
          <LineTrend label={`${name}: CRM ${L("leads")} per day and 7-day average over the last ${p} days`} data={withAvg}
            series={[{ key: "leads", label: L("Leads"), color: "var(--seq-3)", bar: true }, { key: "avg", label: "7-day average", color: "var(--chart-1)" }]} yFormat="num" height={200} />
        </div>
      </div>
    </div>
  );
}

/** Campaign funnel. Width = sqrt share of impressions (late steps stay visible); exact counts printed. */
export function CampaignFunnel({ steps }: { steps: { key: string; label: string; n: number; note?: string }[] }) {
  const reduce = useReducedMotion();
  const max = steps[0]?.n || 1;
  const conv = steps.map((s, i) => (i === 0 ? 1 : steps[i - 1].n > 0 ? s.n / steps[i - 1].n : NaN));
  const worst = conv.map((c, i) => ({ c, i })).filter((x) => x.i >= 3 && Number.isFinite(x.c)).sort((a, b) => a.c - b.c)[0]?.i;
  return (
    <figure aria-label={`Campaign funnel: ${steps.map((s) => `${s.label} ${num(s.n)}`).join(", ")}`}>
      <ol className="space-y-1.5">
        {steps.map((s, i) => {
          const w = Math.max(1.5, Math.sqrt(s.n / max) * 100);
          return (
            <li key={s.key} className="grid grid-cols-[minmax(92px,128px)_1fr_auto] items-center gap-3">
              <span className="truncate text-[12px] text-ink-2" title={s.note}>{s.label}</span>
              <div className="relative h-6 rounded-[4px] bg-paper-2">
                <motion.div className={cn("absolute inset-y-0 left-0 rounded-[4px]", i < 3 ? "bg-seq-2" : "bg-accent")}
                  initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={reduce ? { duration: 0 } : { duration: 0.26, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }} />
                <span className="absolute inset-y-0 flex items-center text-[12px] font-semibold num" style={w > 30 ? { left: 8, color: i >= 3 ? "var(--accent-ink)" : "var(--ink)" } : { left: `calc(${w}% + 6px)`, color: "var(--ink)" }}>{num(s.n)}</span>
              </div>
              <span className={cn("w-[72px] text-right text-[12px] num", worst === i ? "font-semibold text-danger" : "text-ink-3")}>
                {i === 0 ? "—" : pct(conv[i], conv[i] < 0.01 ? 2 : 1)}{i >= 3 && steps[i - 1].n < 20 && <span className="ml-1 text-[10px] font-normal text-ink-3">low n</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <figcaption className="mt-2 text-[11px] leading-4 text-ink-3">{localize(useVocab(), "Grey steps come from the platform export and GA4 (sample); blue steps are counted in the CRM. Right column: conversion from the previous step; red marks the weakest step after lead capture.")}</figcaption>
    </figure>
  );
}

export function NoteDialog({ campaignId }: { campaignId: string }) {
  const notePh = useVocab().cd.notePh;
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog>
      <MktGate can="editCampaigns"><DialogTrigger asChild><Button><StickyNote />Add note</Button></DialogTrigger></MktGate>
      <DialogContent title="Add a note" description="Notes and creative links stay with the campaign. No file uploads in this version.">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-label="Note"
          placeholder={notePh}
          className="w-full rounded-sm border border-line-strong bg-surface p-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-ring" />
        <div className="mt-3 flex justify-end gap-2">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <DialogClose asChild><Button variant="primary" disabled={pending} onClick={() => start(async () => notify(await addCampaignNote(campaignId, text)))}>Save note</Button></DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AttributionToggle({ first, last }: { first: { leads: number; demos: number; won: number; revenue: string }; last: { leads: number; demos: number; won: number; revenue: string } }) {
  const [m, setM] = useState<"first" | "last">("first");
  const r = m === "first" ? first : last;
  const a = useVocab().cd.attr;
  return (
    <div>
      <Segmented label="Attribution model" options={[{ value: "first", label: "First touch" }, { value: "last", label: "Last touch" }]} value={m} onChange={setM} />
      <dl className="mt-3 grid grid-cols-4 gap-2 text-[12px]">
        {([[a.leads, r.leads], [a.demos, r.demos], [a.won, r.won], [a.revenue, r.revenue]] as const).map(([k, v]) => (
          <div key={k} className="rounded-sm border border-line px-2.5 py-2"><dt className="text-ink-3">{k}</dt><dd className="mt-0.5 text-[16px] font-semibold text-ink num">{v}</dd></div>
        ))}
      </dl>
    </div>
  );
}
