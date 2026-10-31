"use client";
// Persisted segment builder. The live size comes from the server (real leads query, RLS applied); the consented count is shown
// separately from the total. Export includes only contacts passing public.can_contact(). Push is disabled with its reason.
import { useEffect, useRef, useState, useTransition } from "react";
import { Download, Link2, Save, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SegmentRule } from "@/lib/segments/compile";
import { attachSegment, exportSegmentConsented, previewSegment, saveSegmentRules, type SegmentPreview } from "../../campaigns/_actions";
import { MktGate, notify } from "../../campaigns/_components/action";

export type SavedSeg = { id: string; name: string; version: number; rules: SegmentRule[]; total: number | null };
type Camp = { id: string; name: string; channel: string; version?: number };
const LABEL: Record<string, string> = { district: "District", city: "City", practice: "Practice area", title: "Role", firm: "Firm", status: "Status", source: "Source", channel: "First-touch channel" };

export function RealBuilder({ saved, options, fields, campaigns, labels }: {
  saved: SavedSeg[]; options: Record<string, string[]>; fields: string[]; campaigns: Camp[]; labels: { consented: string; total: string; push: string };
}) {
  const [current, setCurrent] = useState<SavedSeg | null>(null);
  const [name, setName] = useState("");
  const [rules, setRules] = useState<{ field: string; values: string[] }[]>([]);
  const [adding, setAdding] = useState("");
  const [target, setTarget] = useState(campaigns[0]?.id ?? "");
  const [size, setSize] = useState<SegmentPreview | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [conflict, setConflict] = useState(false);
  const [pending, start] = useTransition();
  const seq = useRef(0);
  const camp = campaigns.find((c) => c.id === target);

  useEffect(() => {
    const n = ++seq.current;
    setState("loading");
    const h = setTimeout(async () => {
      const r = await previewSegment(rules.filter((x) => x.values.length), camp?.channel);
      if (n !== seq.current) return;
      if (r.ok && r.data) { setSize(r.data); setState("idle"); } else { setState("error"); }
    }, 250);
    return () => clearTimeout(h);
  }, [rules, camp?.channel]);

  const open = (s: SavedSeg) => { setCurrent(s); setName(s.name); setRules(s.rules.map((r) => ({ field: r.field, values: r.values }))); setConflict(false); };
  const toggle = (i: number, v: string) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, values: r.values.includes(v) ? r.values.filter((x) => x !== v) : [...r.values, v] } : r)));
  const free = fields.filter((f) => !rules.some((r) => r.field === f));
  const live = rules.filter((r) => r.values.length);

  const save = () => start(async () => {
    const r = await saveSegmentRules({ name, rules: live }, current?.id, current?.version);
    notify(r);
    setConflict(!r.ok && r.code === "conflict");
    if (r.ok && r.data) setCurrent({ id: r.data.id, name, version: r.data.version, rules: live.map((x) => ({ ...x, op: "in" as const })), total: size?.total ?? null });
  });
  const exportCsv = () => start(async () => {
    const r = await exportSegmentConsented(live, camp?.channel);
    notify(r);
    if (r.ok && r.data) {
      const url = URL.createObjectURL(new Blob([r.data.csv], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: r.data.filename });
      a.click();
      URL.revokeObjectURL(url);
    }
  });
  const attach = () => start(async () => { if (current && camp) notify(await attachSegment(camp.id, current.id, camp.version)); });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-3">
        {saved.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="text-ink-3">Open a saved segment</span>
            {saved.map((s) => <button key={s.id} type="button" onClick={() => open(s)} aria-pressed={current?.id === s.id} className={cn("h-8 rounded-sm border px-2.5", current?.id === s.id ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink-2 hover:border-line-strong")}>{s.name}</button>)}
            <button type="button" onClick={() => { setCurrent(null); setName(""); setRules([]); }} className="h-8 rounded-sm border border-line px-2.5 text-ink-2 hover:border-line-strong">New</button>
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink-2">Segment name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-ring" />
        </label>
        {rules.map((r, i) => (
          <fieldset key={r.field} className="rounded-sm border border-line p-3">
            <legend className="sr-only">{LABEL[r.field] ?? r.field}</legend>
            <div className="mb-2 flex items-center justify-between gap-2 text-[12px]">
              <span><span className="font-mono text-[12px] text-ink-3">{i === 0 ? "WHERE" : "AND"}</span> <span className="font-medium text-ink">{LABEL[r.field] ?? r.field}</span> <span className="text-ink-3">is any of</span></span>
              <button type="button" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} className="grid size-7 place-items-center rounded-sm text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label={`Remove ${LABEL[r.field] ?? r.field} rule`}><X className="size-3.5" /></button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(options[r.field] ?? []).length === 0 && <span className="text-[12px] text-ink-3">No values found yet</span>}
              {(options[r.field] ?? []).map((v) => {
                const on = r.values.includes(v);
                return <button key={v} type="button" aria-pressed={on} onClick={() => toggle(i, v)} className={cn("h-8 rounded-sm border px-2.5 text-[12px]", on ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-surface text-ink-2 hover:border-line-strong")}>{v}</button>;
              })}
            </div>
          </fieldset>
        ))}
        {free.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="seg-add">Add rule</label>
            <select id="seg-add" value={adding} onChange={(e) => setAdding(e.target.value)} className="h-8 rounded-sm border border-line-strong bg-surface pl-2.5 pr-7 text-[12px] text-ink-2">
              <option value="">Add a rule…</option>
              {free.map((f) => <option key={f} value={f}>{LABEL[f] ?? f}</option>)}
            </select>
            <Button size="sm" variant="ghost" disabled={!adding} onClick={() => { setRules((rs) => [...rs, { field: adding, values: [] }]); setAdding(""); }}>Add</Button>
          </div>
        )}
        {conflict && <p role="alert" className="rounded-sm border border-warn px-3 py-2 text-[12px] text-warn-ink">Someone else changed this segment. Reload the page to see their version, then apply your change again.</p>}
      </div>

      <aside className="rounded-md border border-line bg-paper p-4" aria-live="polite" aria-busy={state === "loading"}>
        {state === "error" ? <p role="alert" className="text-[12px] text-danger">The size could not be calculated. Your rules were not changed.</p> : (
          <dl className="space-y-3">
            <div><dt className="text-[12px] text-ink-3">{labels.total}</dt><dd className="text-[26px] font-semibold leading-8 text-ink num">{size ? num(size.total) : "–"}</dd></div>
            <div><dt className="text-[12px] text-ink-3">{labels.consented}</dt><dd className="text-[19px] font-semibold text-ink num">{size ? num(size.consented) : "–"}</dd>
              {size?.partial && <p className="text-[12px] text-ink-3">Consent checked for the first {num(size.checked)} only.</p>}</div>
          </dl>
        )}
        <div className="mt-4 space-y-2 border-t border-line pt-4">
          <MktGate can="editSegments"><Button className="w-full" disabled={pending || name.trim().length < 3} onClick={save}><Save />{current ? "Save changes" : "Save segment"}</Button></MktGate>
          <label htmlFor="seg-cmp" className="block pt-1 text-[12px] font-medium text-ink-2">Link to campaign</label>
          <select id="seg-cmp" value={target} onChange={(e) => setTarget(e.target.value)} className="h-9 w-full rounded-sm border border-line-strong bg-surface px-2 text-[12px] text-ink">
            {campaigns.length === 0 && <option value="">No campaigns yet</option>}
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <MktGate can="editCampaigns"><Button variant="secondary" className="w-full" disabled={pending || !current || !camp} onClick={attach}><Link2 />Link saved segment</Button></MktGate>
          <Tip content={labels.push}><span tabIndex={0} className="block"><Button variant="primary" className="w-full" disabled aria-disabled="true"><Send />Push to ad platform</Button></span></Tip>
          <p className="text-[12px] leading-4 text-ink-3">{labels.push}</p>
          <MktGate can="exportCsv"><Button variant="ghost" className="w-full" disabled={pending || !size || size.consented === 0} onClick={exportCsv}><Download />Export {size ? size.consented : 0} consented</Button></MktGate>
          <p className="text-[12px] leading-4 text-ink-3">Export leaves out contacts without consent for this channel and is recorded in the audit trail.</p>
        </div>
      </aside>
    </div>
  );
}
