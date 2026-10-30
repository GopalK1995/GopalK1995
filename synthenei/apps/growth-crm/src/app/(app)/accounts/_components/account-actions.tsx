"use client";
import { FilePlus2, NotebookPen, Upload } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { accountAction } from "../actions";
import { Gated } from "./gated";
import { useVocab } from "@/components/shell/providers";
import type { Verdict } from "./perms";
import { CreateAccountDialog, ExportAccountsButton } from "./record-actions";

const field = "h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] outline-none focus:border-ring";
const Lbl = ({ t, children }: { t: string; children: ReactNode }) => <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t}</span>{children}</label>;

type Kind = Parameters<typeof accountAction>[0];
function useRun(kind: Kind, accountId: string | null, done?: () => void) {
  const [pending, start] = useTransition();
  const run = (form: Record<string, string>) => start(async () => {
    const r = await accountAction(kind, accountId, form);
    toast(r.message, r.sub);
    if (r.ok) done?.();
  });
  return { pending, run };
}
const formObj = (e: React.FormEvent<HTMLFormElement>) => Object.fromEntries([...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, String(v)]));

function FormDialog({ v, trigger, title, description, kind, accountId, submit, children }: {
  v: Verdict; trigger: ReactNode & React.ReactElement<{ disabled?: boolean }>; title: string; description?: string; kind: Kind; accountId: string | null; submit: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun(kind, accountId, () => setOpen(false));
  if (!v.ok) return <Gated v={v}>{trigger}</Gated>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description}>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(formObj(e)); }}>
          {children}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={pending}>{pending ? "Checking…" : submit}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ListActions({ create, importV, exportV, districts, owners }: { create: Verdict; importV: Verdict; exportV: Verdict; districts: string[]; owners: { id: string; name: string }[] }) {
  const imp = useRun("importCsv", null);
  return (
    <>
      <Gated v={importV}><Button size="sm" onClick={() => imp.run({})} disabled={imp.pending}><Upload />Import CSV</Button></Gated>
      <ExportAccountsButton v={exportV} />
      <CreateAccountDialog v={create} owners={owners} districts={districts} />
    </>
  );
}

export function DetailActions({ accountId, firm, createDeal, logActivity, seats, plan }: {
  accountId: string; firm: string; createDeal: Verdict; logActivity: Verdict; seats: number; plan: string;
}) {
  const dl = useVocab().ac.dlg;
  return (
    <>
      <FormDialog v={logActivity} kind="logActivity" accountId={accountId} title="Log activity" description={firm} submit="Log"
        trigger={<Button size="sm"><NotebookPen />Log activity</Button>}>
        <Lbl t="Type"><select name="kind" className={field}>{dl.logTypes.map((k) => <option key={k}>{k}</option>)}</select></Lbl>
        <Lbl t="Notes"><textarea name="notes" className={field + " h-20 py-2"} defaultValue={dl.logNote} /></Lbl>
      </FormDialog>
      <FormDialog v={createDeal} kind="createDeal" accountId={accountId} title={dl.dealTitle} description={dl.dealDesc(firm)} submit={dl.dealBtn}
        trigger={<Button size="sm" variant="primary"><FilePlus2 />{dl.dealBtn}</Button>}>
        <div className="grid grid-cols-2 gap-3">
          <Lbl t={dl.plan}><select name="plan" defaultValue={dl.plans.includes(plan) ? plan : dl.plans[0]} className={field}>{dl.plans.map((p) => <option key={p}>{p}</option>)}</select></Lbl>
          <Lbl t={dl.seats}><input name="seats" type="number" min={1} defaultValue={seats} className={field} /></Lbl>
        </div>
        <Lbl t={dl.closeLbl}><input name="close" type="date" defaultValue="2026-11-14" className={field} /></Lbl>
      </FormDialog>
    </>
  );
}
