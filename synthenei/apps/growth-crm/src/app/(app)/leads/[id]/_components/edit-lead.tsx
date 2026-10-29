"use client";
// Edit lead fields with the version the page was rendered from. A 409 shows the conflict banner instead of overwriting.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Gate } from "@/components/ui/gate";
import { toast } from "@/components/ui/toast";
import { useVocab } from "@/components/shell/providers";
import { lt } from "../../_lib/strings";
import { field } from "../../_lib/sales";
import { updateLead } from "../../actions";
import { ConflictBanner } from "../../_components/conflict-banner";

export type EditableLead = { id: string; version: number | null; fullName: string; roleTitle: string; firmName: string; email: string; phone: string; city: string };
const KEYS = ["fullName", "roleTitle", "firmName", "email", "phone", "city"] as const;

export function EditLead({ lead }: { lead: EditableLead }) {
  const t = lt(useVocab());
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const close = () => { setOpen(false); setErr(null); setConflict(false); setIssues({}); };
  const submit = (f: FormData) => start(async () => {
    const patch: Record<string, string> = {};
    for (const k of KEYS) { const v = String(f.get(k) ?? "").trim(); if (v !== lead[k]) patch[k] = v; }
    if (!Object.keys(patch).length) { setErr(t("edit.nothing")); return; }
    const r = await updateLead(lead.id, { expectedVersion: lead.version ?? 1, patch });
    if (!r.ok) {
      if (r.code === "conflict") setConflict(true); else setErr(r.message);
      setIssues(Object.fromEntries((r.issues ?? []).map((i) => [i.path.replace(/^patch\./, ""), i.message])));
      return;
    }
    toast(r.message, r.sub); close(); router.refresh();
  });
  const labels: Record<(typeof KEYS)[number], string> = { fullName: t("create.name"), roleTitle: t("create.role"), firmName: t("create.firm"), email: t("create.email"), phone: t("create.phone"), city: t("create.city") };
  return (
    <>
      <Gate can="workLeads" showDisabled reason={t("deniedEdit")}><Button variant="ghost" onClick={() => setOpen(true)} data-cy="edit-lead"><Pencil />{t("edit.open")}</Button></Gate>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent title={t("edit.title")} description={lead.fullName}>
          {conflict ? <ConflictBanner title={t("conflictTitle")} body={t("conflictBody")} reload={t("conflictReload")} onReload={close} /> : (
            <form className="space-y-3" action={submit}>
              <div className="grid grid-cols-2 gap-3">
                {KEYS.map((k) => (
                  <label key={k} className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{labels[k]}</span>
                    <input name={k} defaultValue={lead[k]} className={field} aria-invalid={!!issues[k]} />
                    {issues[k] && <span className="mt-1 block text-[12px] text-danger">{issues[k]}</span>}</label>
                ))}
              </div>
              {err && <p role="alert" className="text-[12px] text-danger">{err}</p>}
              <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" disabled={pending}>{t("edit.submit")}</Button></div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
