"use client";
import { useMemo, useState, useTransition } from "react";
import { Download, Save, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/badge";
import { num, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SegLead } from "../../campaigns/_lib/marketing";
import { exportSegment, saveSegment, sendSegmentToCampaign } from "../../campaigns/_actions";
import { MktGate, notify } from "../../campaigns/_components/action";

type FieldKey = "district" | "size" | "title" | "practice" | "court" | "channel";
type Rule = { field: FieldKey; values: string[] };
const FIELDS: { key: FieldKey; label: string }[] = [
  { key: "district", label: "District" }, { key: "size", label: "Firm size" }, { key: "title", label: "Role" },
  { key: "practice", label: "Practice area" }, { key: "court", label: "Court focus" }, { key: "channel", label: "Source channel" },
];
const valueOf = (l: SegLead, f: FieldKey) => (f === "court" ? (l.highCourt ? "Madras High Court / Madurai Bench" : "District courts only") : f === "channel" ? l.channel : l[f]);

/** Rule builder: AND across rules, OR within a rule's values. Counts recompute as you click (aggregates only). */
export function SegmentBuilder({ leads, options, campaigns, channelLabel }: {
  leads: SegLead[]; options: Record<FieldKey, string[]>; campaigns: { id: string; name: string; channel: string }[]; channelLabel: Record<string, string>;
}) {
  const [name, setName] = useState("Madurai Bench senior advocates");
  const [rules, setRules] = useState<Rule[]>([{ field: "district", values: ["Madurai", "Tirunelveli"] }, { field: "court", values: ["Madras High Court / Madurai Bench"] }]);
  const [adding, setAdding] = useState<FieldKey | "">("");
  const [target, setTarget] = useState(campaigns[0]?.id ?? "");
  const [pending, start] = useTransition();

  const match = useMemo(() => leads.filter((l) => rules.every((r) => !r.values.length || r.values.includes(valueOf(l, r.field)))), [leads, rules]);
  const demos = match.filter((l) => l.demo).length, closed = match.filter((l) => l.closed).length, won = match.filter((l) => l.won).length;
  const consented = match.filter((l) => l.marketingConsent).length;
  const toggle = (i: number, v: string) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, values: r.values.includes(v) ? r.values.filter((x) => x !== v) : [...r.values, v] } : r)));
  const label = (f: FieldKey, v: string) => (f === "channel" ? channelLabel[v] ?? v : v);
  const free = FIELDS.filter((f) => !rules.some((r) => r.field === f.key));

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
      <div className="min-w-0 space-y-3">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Segment name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-ring" />
        </label>
        {rules.map((r, i) => (
          <fieldset key={r.field} className="rounded-sm border border-line p-3">
            <legend className="sr-only">{FIELDS.find((f) => f.key === r.field)!.label}</legend>
            <div className="mb-2 flex items-center justify-between gap-2 text-[12px]">
              <span><span className="font-mono text-[11px] text-ink-3">{i === 0 ? "WHERE" : "AND"}</span> <span className="font-medium text-ink">{FIELDS.find((f) => f.key === r.field)!.label}</span> <span className="text-ink-3">is any of</span></span>
              <button type="button" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label={`Remove ${FIELDS.find((f) => f.key === r.field)!.label} rule`}><X className="size-3.5" /></button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {options[r.field].map((v) => {
                const on = r.values.includes(v);
                return (
                  <button key={v} type="button" aria-pressed={on} onClick={() => toggle(i, v)}
                    className={cn("h-8 rounded-sm border px-2.5 text-[12px] transition-colors duration-150", on ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink-2 hover:border-line-strong", v === "Unknown" && !on && "text-ink-3")}>
                    {label(r.field, v)}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        {free.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="seg-add">Add rule</label>
            <select id="seg-add" value={adding} onChange={(e) => setAdding(e.target.value as FieldKey)} className="h-8 rounded-sm border border-line-strong bg-surface pl-2.5 pr-7 text-[12px] text-ink-2">
              <option value="">Add a rule…</option>
              {free.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <Button size="sm" variant="ghost" disabled={!adding} onClick={() => { if (adding) { setRules((rs) => [...rs, { field: adding, values: [] }]); setAdding(""); } }}>Add</Button>
          </div>
        )}
      </div>

      <aside className="rounded-md border border-line bg-paper p-4" aria-live="polite">
        <div className="text-[12px] text-ink-3">Matching leads</div>
        <div className="text-[28px] font-semibold leading-9 text-ink num">{num(match.length)}<span className="ml-1 text-[13px] font-normal text-ink-3">of {num(leads.length)}</span></div>
        <dl className="mt-3 space-y-1.5 text-[12px]">
          <div className="flex justify-between"><dt className="text-ink-3">Lead → demo</dt><dd className="font-medium text-ink num">{pct(match.length ? demos / match.length : NaN, 0)}{match.length < 20 && <span className="ml-1 text-[10px] font-normal text-ink-3">low n</span>}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-3">Win rate (closed)</dt><dd className="font-medium text-ink num">{closed ? pct(won / closed, 0) : "–"}{closed > 0 && closed < 20 && <span className="ml-1 text-[10px] font-normal text-ink-3">low n</span>}</dd></div>
          <div className="flex justify-between"><dt className="text-ink-3">Marketing consent</dt><dd className="font-medium text-ink num">{consented} <span className="font-normal text-ink-3">exportable</span></dd></div>
        </dl>
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <MktGate can="editSegments">
            <Button className="w-full" disabled={pending} onClick={() => start(async () => notify(await saveSegment(name, rules.filter((r) => r.values.length).length)))}><Save />Save segment</Button>
          </MktGate>
          <div className="flex items-center justify-between gap-2 pt-1">
            <label htmlFor="seg-cmp" className="text-[12px] font-medium text-ink-2">Send to campaign</label>
            <StatusChip status="showcase" />
          </div>
          <select id="seg-cmp" value={target} onChange={(e) => setTarget(e.target.value)} className="h-9 w-full rounded-sm border border-line-strong bg-surface px-2 text-[12px] text-ink">
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <MktGate can="editCampaigns">
            <Button variant="primary" className="w-full" disabled={pending || !match.length} onClick={() => start(async () => notify(await sendSegmentToCampaign(name, match.length, target)))}><Send />Attach to campaign</Button>
          </MktGate>
          <MktGate can="exportCsv">
            <Button variant="ghost" className="w-full" disabled={pending || !consented} onClick={() => start(async () => notify(await exportSegment(name, consented)))}><Download />Export {consented} for platform upload</Button>
          </MktGate>
          <p className="text-[11px] leading-4 text-ink-3">Export leaves out contacts without marketing consent and is audit-logged.</p>
        </div>
      </aside>
    </div>
  );
}
