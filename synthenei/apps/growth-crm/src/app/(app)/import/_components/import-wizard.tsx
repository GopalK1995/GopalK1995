"use client";
// Import wizard: file -> columns -> review -> progress. Used on /import and inside the leads import dialog.
// Real sessions upload straight to the private bucket (signed URL), then the import runs in the `import` queue; progress comes from
// import_jobs change broadcasts with a short poll as a safety net. Demo sessions run the planner over a sample (or a local CSV) and save nothing.
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { getRealtime } from "@/lib/realtime/client";
import { useTableChanges } from "@/lib/realtime/hooks";
import { ACCEPT_EXT, MAX_FILE_BYTES, MAX_ROWS } from "@/lib/import/limits";
import type { ImportObject, Mapping } from "@/lib/import/types";
import { confirmImport, errorReportUrl, getImportJob, inspectUpload, previewImport, startUpload } from "../actions";
import type { InspectView, JobView, ObjectOption, PreviewView } from "../types";

type Step = "file" | "map" | "review" | "run";
const sel = "h-8 w-full rounded-control border border-line-strong bg-surface px-2 text-13 text-ink";

export function ImportWizard({ objects, object: fixed, demo, onClose }: { objects: ObjectOption[]; object?: ImportObject; demo: boolean; onClose?: () => void }) {
  const t = useTranslations("imports");
  const [object, setObject] = useState<ImportObject>(fixed ?? objects[0]?.key ?? "lead");
  const [step, setStep] = useState<Step>("file");
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [jobId, setJobId] = useState("");
  const [demoText, setDemoText] = useState<string | undefined>();
  const [view, setView] = useState<InspectView | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [remember, setRemember] = useState(false);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [mode, setMode] = useState<"skip" | "merge">("skip");
  const [job, setJob] = useState<JobView | null>(null);
  const [demoDone, setDemoDone] = useState<string | null>(null);
  const jobRef = useRef("");
  jobRef.current = jobId;

  const reset = () => { setStep("file"); setErr(null); setInfo(null); setView(null); setPreview(null); setJob(null); setDemoDone(null); setFileName(""); setJobId(""); setDemoText(undefined); setRemember(false); setMode("skip"); };

  const inspect = (id: string, text?: string) => start(async () => {
    setInfo(t("inspecting", { name: fileName || "sample" }));
    const r = await inspectUpload({ jobId: id, object, demoText: text });
    setInfo(null);
    if (!r.ok || !r.data) { setErr(r.message); return; }
    setView(r.data); setMapping(r.data.mapping); setStep("map");
    if (r.data.savedUsed) setInfo(t("savedMappingUsed"));
  });

  const onFile = (f: File | undefined) => {
    setErr(null);
    if (!f) return;
    if (!ACCEPT_EXT.some((e) => f.name.toLowerCase().endsWith(e))) { setErr(t("unsupported")); return; }
    if (f.size > MAX_FILE_BYTES) { setErr(t("tooBig", { mb: MAX_FILE_BYTES / 1024 / 1024 })); return; }
    setFileName(f.name);
    start(async () => {
      if (demo) {
        if (!f.name.toLowerCase().endsWith(".csv")) { setErr(t("unsupported")); return; }
        const text = await f.text();
        setDemoText(text); setJobId("demo");
        inspect("demo", text);
        return;
      }
      setInfo(t("uploading", { name: f.name }));
      const tk = await startUpload({ object, fileName: f.name, size: f.size });
      if (!tk.ok || !tk.data?.token || !tk.data.path) { setInfo(null); setErr(tk.message || t("uploadFailed")); return; }
      const sb = getRealtime();
      const up = sb ? await sb.storage.from(tk.data.bucket ?? "imports").uploadToSignedUrl(tk.data.path, tk.data.token, f) : null;
      if (!up || up.error) { setInfo(null); setErr(t("uploadFailed")); return; }
      setJobId(tk.data.jobId);
      inspect(tk.data.jobId);
    });
  };

  const useSample = () => { setErr(null); setFileName("sample.csv"); setJobId("demo"); setDemoText(undefined); inspect("demo", undefined); };

  const toReview = () => start(async () => {
    setErr(null);
    const r = await previewImport({ jobId, object, mapping, demoText });
    if (!r.ok || !r.data) { setErr(r.message); return; }
    setPreview(r.data); setStep("review");
  });

  const go = () => start(async () => {
    setErr(null);
    const c = preview?.summary;
    const r = await confirmImport({ jobId, object, mapping, mode, remember, demoCounts: c ? { fresh: c.fresh, dup: c.duplicates, invalid: c.invalid } : undefined });
    if (!r.ok) { setErr(r.message || t("startFailed")); return; }
    toast(r.message, r.sub);
    setStep("run");
    if (r.data?.demo) setDemoDone(r.message); else poll();
  });

  const poll = useCallback(async () => {
    const id = jobRef.current;
    if (!id || id === "demo") return;
    const r = await getImportJob(id);
    if (r.ok && r.data) setJob(r.data);
  }, []);
  useTableChanges("import_jobs", () => { void poll(); }, { authorize: !demo });
  const active = step === "run" && !demoDone && (!job || ["mapped", "validating", "running", "uploaded"].includes(job.status));
  useEffect(() => {
    if (!active) return;
    const h = setInterval(() => { void poll(); }, 2000);
    return () => clearInterval(h);
  }, [active, poll]);

  const downloadErrors = () => start(async () => {
    const r = await errorReportUrl(jobId);
    if (r.ok && r.data) window.location.assign(r.data.url); else setErr(r.message);
  });

  const missing = view ? (() => {
    const used = new Set(Object.values(mapping).filter(Boolean));
    const need = view.targets.filter((x) => x.required && !used.has(x.key)).map((x) => x.label);
    if (object === "lead" && !used.has("email") && !used.has("phone")) need.push(t("missingContact"));
    const dup = [...used].filter((k) => Object.values(mapping).filter((v) => v === k).length > 1);
    return { need, dup: dup.map((k) => view.targets.find((x) => x.key === k)?.label ?? k) };
  })() : { need: [], dup: [] };
  const canContinue = !!view && missing.need.length === 0 && missing.dup.length === 0;
  const stepIx = ["file", "map", "review", "run"].indexOf(step);
  const writeCount = preview ? preview.summary.fresh + (mode === "merge" ? preview.summary.duplicates : 0) : 0;

  return (
    <div className="space-y-4" data-testid="import-wizard">
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-12 text-ink-3" aria-label="Steps">
        {(["stepFile", "stepMap", "stepReview", "stepRun"] as const).map((k, i) => <li key={k} aria-current={i === stepIx ? "step" : undefined} className={i === stepIx ? "font-semibold text-ink" : ""}>{i + 1}. {t(k)}</li>)}
      </ol>
      {demo && <p className="rounded-chip bg-paper-2 px-3 py-2 text-13 text-ink-2">{t("demoBanner")}</p>}
      {err && <p role="alert" className="rounded-chip bg-danger-soft px-3 py-2 text-13 text-danger" data-testid="import-error">{err}</p>}
      {info && !err && <p role="status" className="text-13 text-ink-3">{info}</p>}

      {step === "file" && (
        <div className="space-y-3">
          {!fixed && objects.length > 1 && (
            <label className="block text-13"><span className="mb-1 block text-12 font-medium text-ink-2">{t("chooseObject")}</span>
              <select data-testid="import-object" className={sel} value={object} onChange={(e) => setObject(e.target.value as ImportObject)}>{objects.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select>
            </label>
          )}
          <label className="block"><span className="mb-1 block text-12 font-medium text-ink-2">{t("fileLabel")}</span>
            <input data-testid="import-file" type="file" accept={ACCEPT_EXT.join(",")} disabled={busy} onChange={(e) => onFile(e.target.files?.[0])}
              className="block w-full text-13 text-ink-2 file:mr-3 file:h-8 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:text-13 file:font-medium file:text-ink hover:file:bg-paper-2" />
          </label>
          <p className="text-12 text-ink-3">{t("fileHint", { mb: MAX_FILE_BYTES / 1024 / 1024, rows: MAX_ROWS.toLocaleString("en-IN") })}</p>
          {demo && <div><Button data-testid="import-use-sample" size="sm" onClick={useSample} disabled={busy}>{t("useSample")}</Button><p className="mt-1 text-12 text-ink-3">{t("sampleNote")}</p></div>}
        </div>
      )}

      {step === "map" && view && (
        <div className="space-y-3">
          <div><h3 className="text-14 font-semibold text-ink">{t("mapTitle")}</h3><p className="text-13 text-ink-2">{t("mapDesc", { rows: view.rows })}</p></div>
          <div className="overflow-x-auto rounded-chip border border-line">
            <table className="w-full text-left text-13">
              <thead className="bg-paper-2 text-12 text-ink-3"><tr><th className="px-3 py-2 font-medium">{t("colHeader")}</th><th className="px-3 py-2 font-medium">{t("colSample")}</th><th className="px-3 py-2 font-medium">{t("colTarget")}</th></tr></thead>
              <tbody>
                {view.headers.map((h, i) => (
                  <tr key={h} className="border-t border-line">
                    <td className="px-3 py-2 font-medium text-ink">{h}</td>
                    <td className="max-w-48 truncate px-3 py-2 text-ink-3">{view.sample.map((s) => s[h]).filter(Boolean).slice(0, 3).join(", ")}</td>
                    <td className="px-3 py-2">
                      <select aria-label={`${t("colTarget")}: ${h}`} data-testid={`import-map-${i}`} className={sel} value={mapping[h] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value }))}>
                        <option value="">{t("ignore")}</option>
                        <optgroup label={t("systemGroup")}>{view.targets.filter((x) => !x.custom).map((x) => <option key={x.key} value={x.key}>{x.label}{x.required ? ` (${t("required")})` : ""}</option>)}</optgroup>
                        {view.targets.some((x) => x.custom) && <optgroup label={t("customGroup")}>{view.targets.filter((x) => x.custom).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {missing.need.length > 0 && <p role="status" className="text-13 text-warn-ink" data-testid="import-missing">{t("missingRequired", { fields: missing.need.join(", ") })}</p>}
          {missing.dup.length > 0 && <p role="status" className="text-13 text-warn-ink">{t("duplicateTargets", { fields: missing.dup.join(", ") })}</p>}
          {!demo && <label className="flex items-center gap-2 text-13 text-ink-2"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[var(--accent)]" />{t("saveMapping")}</label>}
        </div>
      )}

      {step === "review" && preview && (
        <div className="space-y-3" aria-live="polite">
          <h3 className="text-14 font-semibold text-ink">{t("reviewTitle")}</h3>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {([["statNew", preview.summary.fresh, "new", "text-ink"], ["statDuplicate", preview.summary.duplicates, "dup", "text-warn-ink"], ["statInvalid", preview.summary.invalid, "invalid", preview.summary.invalid ? "text-danger" : "text-ink"]] as const).map(([k, v, id, c]) => (
              <div key={k} className="rounded-chip border border-line p-2"><dt className="text-12 text-ink-3">{t(k)}</dt><dd data-testid={`import-stat-${id}`} className={`text-[20px] font-semibold num ${c}`}>{v}</dd></div>
            ))}
          </dl>
          <p className="text-12 text-ink-3">{t("dupRule")}</p>
          {preview.problems.length > 0 && (
            <div><p className="text-13 text-ink-2">{t("problemsNote")}</p>
              <ul className="mt-1 space-y-0.5 text-12 text-ink-3">{preview.problems.map((p) => <li key={`${p.rowNo}-${p.field}`}>{p.rowNo}: {p.message}</li>)}</ul></div>
          )}
          {preview.summary.duplicates > 0 && (
            <fieldset className="space-y-1 text-13"><legend className="mb-1 text-12 font-medium text-ink-2">{t("dupHandling")}</legend>
              <label className="flex items-center gap-2"><input type="radio" name="dup-mode" data-testid="import-mode-skip" checked={mode === "skip"} onChange={() => setMode("skip")} className="accent-[var(--accent)]" />{t("dupSkip")}</label>
              <label className="flex items-center gap-2"><input type="radio" name="dup-mode" data-testid="import-mode-merge" checked={mode === "merge"} onChange={() => setMode("merge")} className="accent-[var(--accent)]" />{t("dupMerge")}</label>
            </fieldset>
          )}
        </div>
      )}

      {step === "run" && (
        <div className="space-y-3" aria-live="polite" data-testid="import-run">
          {demoDone && <p data-testid="import-result" className="rounded-chip bg-paper-2 px-3 py-2 text-13 text-ink">{demoDone}<span className="block text-12 text-ink-3">{t("demoResultSub")}</span></p>}
          {!demoDone && (!job || job.status === "mapped" || job.status === "validating" || job.status === "running") && (
            <div><p className="text-13 text-ink-2">{job && job.status === "running" ? t("progress", { done: job.rowsOk, total: job.rowsTotal }) : t("queued")}</p>
              <div role="progressbar" aria-valuemin={0} aria-valuemax={job?.rowsTotal || 1} aria-valuenow={job?.rowsOk ?? 0} data-testid="import-progress" className="mt-2 h-1.5 w-full overflow-hidden rounded-bar bg-paper-2">
                <div className="h-full bg-accent" style={{ width: `${job && job.rowsTotal ? Math.min(100, Math.round((job.rowsOk / job.rowsTotal) * 100)) : 4}%` }} /></div></div>
          )}
          {job?.status === "done" && (
            <div data-testid="import-result"><p className="text-14 font-semibold text-ink">{t("doneTitle")}</p>
              <p className="text-13 text-ink-2">{t("doneSummary", { ok: job.rowsOk, dup: job.rowsDup, invalid: job.rowsInvalid })}</p>
              {job.hasReport && <Button data-testid="import-download-errors" size="sm" className="mt-2" onClick={downloadErrors} disabled={busy}>{t("downloadErrors")}</Button>}</div>
          )}
          {job?.status === "failed" && <div data-testid="import-result"><p className="text-14 font-semibold text-danger">{t("failedTitle")}</p><p className="text-13 text-ink-2">{t("failedBody")}</p></div>}
          {job?.status === "cancelled" && <p data-testid="import-result" className="text-14 font-semibold text-ink">{t("cancelledTitle")}</p>}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {step === "map" && <Button variant="ghost" onClick={() => { reset(); }} disabled={busy}>{t("back")}</Button>}
        {step === "review" && <Button variant="ghost" onClick={() => setStep("map")} disabled={busy}>{t("back")}</Button>}
        {step === "run" ? (
          <>
            {(demoDone || (job && ["done", "failed", "cancelled"].includes(job.status))) && <Button onClick={reset}>{t("stepFile")}</Button>}
            {onClose && <Button variant="primary" onClick={onClose}>{t("close")}</Button>}
          </>
        ) : (
          <>
            {step !== "file" && onClose && <Button variant="ghost" onClick={onClose} disabled={busy}>{t("cancel")}</Button>}
            {step === "map" && <Button data-testid="import-continue" variant="primary" onClick={toReview} disabled={busy || !canContinue}>{t("next")}</Button>}
            {step === "review" && <Button data-testid="import-start" variant="primary" onClick={go} disabled={busy || writeCount + (preview?.summary.invalid ?? 0) === 0 || (writeCount === 0)}>{t("importRows", { n: writeCount })}</Button>}
          </>
        )}
      </div>
    </div>
  );
}
