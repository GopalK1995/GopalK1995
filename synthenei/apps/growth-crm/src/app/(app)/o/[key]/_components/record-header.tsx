"use client";
// Record title with inline rename (primary field) and delete. Both send the record version the page rendered; a stale version is a
// conflict and the person is asked to reload, never overwritten. Controls the viewer may not use are shown disabled with the reason.
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { tIn } from "@/lib/layouts/strings";
import { deleteRecord, renameRecord } from "../actions";

export function RecordHeader(p: {
  objectKey: string; id: string; version: number; title: string; masked: boolean; strings: Record<string, string>; noun: string; primaryLabel: string;
  canWrite: boolean; canDelete: boolean; demo: boolean; backHref: string;
}) {
  const router = useRouter();
  const t = tIn(p.strings);
  const tn = (k: string, v: Record<string, string | number> = {}) => t(k, { noun: p.noun, ...v });
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(p.title);
  const [shown, setShown] = useState(p.title);
  const [version, setVersion] = useState(p.version);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  const save = () => start(async () => {
    const r = await renameRecord({ objectKey: p.objectKey, id: p.id, version, title });
    if (r.ok) { setShown(r.data?.title ?? title); setVersion(r.data?.version ?? version); setEditing(false); setErr(null); toast(r.message, r.sub); router.refresh(); return; }
    setErr(`${r.message}${r.sub ? ` ${r.sub}` : ""}`);
  });
  const remove = () => start(async () => {
    const r = await deleteRecord({ objectKey: p.objectKey, id: p.id, version });
    if (r.ok) { toast(r.message, r.sub); router.push(p.backHref); router.refresh(); return; }
    setErr(`${r.message}${r.sub ? ` ${r.sub}` : ""}`); setConfirm(false);
  });

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {editing ? (
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <Input aria-label={p.primaryLabel} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} autoFocus className="h-9 w-72 text-15" />
            <Button type="submit" variant="primary" size="sm" disabled={pending || !title.trim()}>{pending ? t("saving") : t("save")}</Button>
            <Button type="button" variant="quiet" size="sm" onClick={() => { setEditing(false); setTitle(shown); setErr(null); }}>{t("cancel")}</Button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <h1 className="truncate text-20 font-semibold text-ink">{shown || "–"}</h1>
            <Button size="icon" variant="ghost" className="size-7" aria-label={tn("renameRecord")} onClick={() => { setTitle(shown); setEditing(true); }}
              disabledReason={p.masked ? t("titleMasked") : p.canWrite ? undefined : t("readOnlyReason")}><Pencil aria-hidden /></Button>
          </div>
        )}
        {err && <p role="alert" className="mt-2 state-danger rounded-control border px-3 py-2 text-13">{err}</p>}
      </div>
      <Button variant="danger" size="sm" onClick={() => setConfirm(true)} disabledReason={p.canDelete ? undefined : t("deleteDenied")}><Trash2 aria-hidden />{tn("deleteRecord")}</Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent title={tn("deleteRecordTitle")} description={tn("deleteRecordBody")}>
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onClick={() => setConfirm(false)}>{t("cancel")}</Button>
            <Button variant="danger" disabled={pending} onClick={remove}>{pending ? t("saving") : tn("deleteRecordConfirm")}</Button>
          </div>
          {p.demo && <p className="mt-2 text-12 text-ink-3">{t("demoNotSaved")}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
