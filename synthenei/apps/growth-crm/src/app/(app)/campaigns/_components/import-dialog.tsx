"use client";
// Daily-metrics CSV import with a PREVIEW step. Nothing is written until "Write rows" is pressed; the server re-parses the text.
// (The full import engine is T034; this handles a simple per-day metrics file.)
import { useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { inr } from "@/lib/format";
import { importCampaignCsv, importMetrics, previewMetrics, type MetricsPreviewResult } from "../_actions";
import { MktGate, notify } from "./action";
import { useSession, useVocab } from "@/components/shell/providers";

const lbl = "mb-1 block text-[12px] font-medium text-ink-2";
const REASON: Record<string, string> = {
  bad_date: "Date not recognised", future_date: "Date is in the future", unknown_campaign: "No campaign with this UTM or name", bad_number: "A number is not valid",
  negative: "Negative value", duplicate_day: "Same campaign and day appears twice", missing_campaign: "Campaign column is empty",
};

export function ImportCsvDialog({ campaigns, campaignId }: { campaigns: { id: string; name: string; channel: string }[]; campaignId?: string }) {
  const fixed = campaigns.find((c) => c.id === campaignId);
  const v = useVocab().cd;
  const { demo } = useSession();
  const [platform, setPlatform] = useState<string>(fixed?.channel ?? v.defaultChannel);
  const [text, setText] = useState("");
  const [prev, setPrev] = useState<MetricsPreviewResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const p = v.platforms.find((x) => x.key === platform) ?? v.platforms[0];

  const onFile = async (f: File | undefined) => {
    setPrev(null); setErr(null);
    if (!f) return setText("");
    if (f.size > 5 * 1024 * 1024) return setErr("Use a file up to 5 MB.");
    setText(await f.text());
  };
  const preview = () => start(async () => {
    if (demo) return notify(await importCampaignCsv(p.label, campaignId));
    const r = await previewMetrics(text, campaignId);
    if (r.ok) { setPrev(r.data ?? null); setErr(null); } else { setPrev(null); setErr(`${r.message}${r.sub ? ` ${r.sub}` : ""}`); }
  });
  const write = () => start(async () => { const r = await importMetrics(text, campaignId); notify(r); if (r.ok) { setPrev(null); setText(""); } });

  return (
    <Dialog>
      <MktGate can="importCsv"><DialogTrigger asChild><Button><Upload />{campaignId ? "Import daily metrics" : "Import results CSV"}</Button></DialogTrigger></MktGate>
      <DialogContent title={campaignId ? `Import daily metrics: ${fixed?.name ?? ""}` : "Import campaign results"} description="Upload a platform export. You see the column mapping and rejected rows before anything is written.">
        <div className="space-y-4">
          <div>
            <label className={lbl} htmlFor="imp-platform">Platform template</label>
            <select id="imp-platform" className="h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] text-ink" value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={!!fixed}>
              {v.platforms.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </div>
          <div className="rounded-sm border border-line bg-paper px-3 py-2 text-[12px] text-ink-2">
            <div className="font-medium text-ink">Expected columns</div>
            <div className="mt-0.5 font-mono text-[12px] leading-5 text-ink-3">date, utm_campaign, spend, impressions, reach, clicks, leads</div>
            <div className="mt-1.5">Campaign is matched on <span className="font-mono text-[12px]">utm_campaign</span> or the exact campaign name. Importing the same day again replaces that day.</div>
          </div>
          <div>
            <label className={lbl} htmlFor="imp-file">File (.csv, max 5 MB)</label>
            <input id="imp-file" type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} className="block w-full text-[12px] text-ink-2 file:mr-3 file:h-8 file:rounded-sm file:border file:border-line-strong file:bg-surface file:px-3 file:text-[12px] file:text-ink" />
          </div>
          {err && <p role="alert" className="rounded-sm border border-danger px-3 py-2 text-[12px] text-danger">{err}</p>}
          {prev && (
            <div className="rounded-sm border border-line px-3 py-2 text-[12px]" aria-live="polite">
              <div className="font-medium text-ink num">{prev.accepted} of {prev.rows} rows ready · {inr(prev.totalSpend)} spend</div>
              <div className="mt-1 text-ink-3">Columns: {prev.mapping.map((m) => `${m.column} → ${m.field ?? "ignored"}`).join(", ")}</div>
              {prev.rejected.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-warn-ink">
                  {prev.rejected.slice(0, 8).map((r) => <li key={r.line} className="num">Line {r.line}: {REASON[r.reason] ?? r.reason}</li>)}
                  {prev.rejected.length > 8 && <li>and {prev.rejected.length - 8} more rejected rows</li>}
                </ul>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
            <Button variant="secondary" disabled={pending || (!demo && !text)} onClick={preview}>Preview mapping</Button>
            {!demo && <Button variant="primary" disabled={pending || !prev || prev.accepted === 0} onClick={write}>Write rows</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
