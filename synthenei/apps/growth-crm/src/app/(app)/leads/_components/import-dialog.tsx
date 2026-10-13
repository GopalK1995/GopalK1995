"use client";
// CSV import: upload -> column check -> dedupe preview -> confirm (spec 5, /leads). Server actions re-check importCsv.
import { useState, useTransition } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { confirmImport, previewImport } from "../actions";
import { Gate } from "@/components/ui/gate";

type Preview = { rows: number; fresh: number; duplicates: number; invalid: number; columns: string[] };

export function ImportDialog() {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"merge" | "skip">("skip");
  const [pending, start] = useTransition();
  const reset = () => { setFile(null); setPreview(null); setErr(null); };

  const onFile = async (f: File | undefined) => {
    reset();
    if (!f) return;
    if (f.size > 2_000_000) { setErr("Files up to 2 MB. Split larger exports by district."); return; }
    setFile(f.name);
    const text = await f.text();
    start(async () => {
      const r = await previewImport(text);
      if (!r.ok || !r.preview) setErr(r.message); else setPreview(r.preview);
    });
  };
  const onConfirm = () => start(async () => {
    if (!preview) return;
    const r = await confirmImport(preview.fresh, preview.duplicates, mode);
    toast(r.message, r.sub);
    if (r.ok) { setOpen(false); reset(); }
  });

  return (
    <>
      <Gate can="importCsv">
        <Button size="sm" onClick={() => setOpen(true)}><FileUp />Import CSV</Button>
      </Gate>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent title="Import leads from CSV" description="Columns we read: name, phone, email, firm, city, role, source. Duplicates match on phone or email.">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-ink-2">CSV file</span>
              <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])}
                className="block w-full text-[13px] text-ink-2 file:mr-3 file:h-9 file:rounded-sm file:border file:border-line-strong file:bg-surface file:px-3 file:text-[13px] file:font-medium file:text-ink hover:file:bg-paper-2" />
            </label>
            {pending && !preview && <p className="text-[13px] text-ink-3" aria-live="polite">Checking {file} against this workspace…</p>}
            {err && <p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-[13px] text-danger">{err}</p>}
            {preview && (
              <div className="space-y-3" aria-live="polite">
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {[["New", preview.fresh, "text-ink"], ["Duplicates", preview.duplicates, "text-warn-ink"], ["Invalid phone/email", preview.invalid, preview.invalid ? "text-danger" : "text-ink"]].map(([k, v, c]) => (
                    <div key={k as string} className="rounded-sm border border-line p-2">
                      <dt className="text-[11px] text-ink-3">{k}</dt><dd className={`text-[20px] font-semibold num ${c}`}>{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-[12px] text-ink-3">{preview.rows} rows in {file}. Columns found: {preview.columns.slice(0, 8).join(", ")}{preview.columns.length > 8 ? "…" : ""}.{preview.invalid > 0 && " Invalid rows go to a rejects file you can download after import."}</p>
                {preview.duplicates > 0 && (
                  <fieldset className="flex flex-wrap gap-4 text-[13px]">
                    <legend className="mb-1 text-[12px] font-medium text-ink-2">Duplicates</legend>
                    <label className="inline-flex items-center gap-1.5"><input type="radio" name="dup" checked={mode === "skip"} onChange={() => setMode("skip")} className="accent-[var(--accent)]" />Skip them</label>
                    <label className="inline-flex items-center gap-1.5"><input type="radio" name="dup" checked={mode === "merge"} onChange={() => setMode("merge")} className="accent-[var(--accent)]" />Merge into existing lead</label>
                  </fieldset>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" disabled={!preview || pending || preview.fresh + preview.duplicates === 0} onClick={onConfirm}>Import {preview ? preview.fresh + (mode === "merge" ? preview.duplicates : 0) : ""} leads</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
