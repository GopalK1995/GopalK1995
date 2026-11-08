"use client";
// Export of a list view. `ExportButton` can be dropped on any list (pass the ids currently shown, or none for the whole object);
// `ExportPanel` is the /import version with an object picker. Masking and the support-session block are decided on the server.
import { useState, useTransition } from "react";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { ImportObject } from "@/lib/import/types";
import { exportList } from "../actions";
import type { ObjectOption } from "../types";

function download(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useExport() {
  const t = useTranslations("imports");
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string; sub?: string } | null>(null);
  const run = (object: ImportObject, ids: string[] | undefined, maskPersonal: boolean) => start(async () => {
    setMsg(null);
    const r = await exportList({ object, ids, maskPersonal });
    if (!r.ok || !r.data) { setMsg({ ok: false, text: r.message }); toast(r.message, r.sub ?? t("exportFailed")); return; }
    download(r.data.csv, r.data.filename);
    setMsg({ ok: true, text: r.message, sub: r.sub });
    toast(r.message, r.sub);
  });
  return { t, busy, msg, run };
}

export function ExportButton({ object, ids, maskPersonal = false, label }: { object: ImportObject; ids?: string[]; maskPersonal?: boolean; label?: string }) {
  const { t, busy, run } = useExport();
  return <Button size="sm" data-testid="export-button" disabled={busy} onClick={() => run(object, ids, maskPersonal)}><Download className="size-3.5" aria-hidden />{label ?? t("exportButton")}</Button>;
}

export function ExportPanel({ objects }: { objects: ObjectOption[] }) {
  const { t, busy, msg, run } = useExport();
  const [object, setObject] = useState<ImportObject>(objects[0]?.key ?? "lead");
  const [mask, setMask] = useState(false);
  return (
    <div className="space-y-3" data-testid="export-panel">
      <p className="text-13 text-ink-2">{t("exportDesc")}</p>
      <label className="block max-w-xs text-13"><span className="mb-1 block text-12 font-medium text-ink-2">{t("exportObject")}</span>
        <select data-testid="export-object" className="h-8 w-full rounded-control border border-line-strong bg-surface px-2 text-13 text-ink" value={object} onChange={(e) => setObject(e.target.value as ImportObject)}>
          {objects.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-13 text-ink-2"><input data-testid="export-mask" type="checkbox" checked={mask} onChange={(e) => setMask(e.target.checked)} className="accent-[var(--accent)]" />{t("exportMask")}</label>
      <Button data-testid="export-run" variant="primary" disabled={busy} onClick={() => run(object, undefined, mask)}><Download className="size-3.5" aria-hidden />{t("exportBtn")}</Button>
      {msg && <p role={msg.ok ? "status" : "alert"} data-testid="export-result" className={`text-13 ${msg.ok ? "text-ink-2" : "text-danger"}`}>{msg.text}{msg.sub ? <span className="block text-12 text-ink-3">{msg.sub}</span> : null}</p>}
    </div>
  );
}
