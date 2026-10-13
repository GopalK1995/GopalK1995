"use client";
import { Building2, Download, FilePlus2, NotebookPen, Upload, UserPlus } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { accountAction } from "../actions";
import { Gated } from "./gated";
import type { Verdict } from "./perms";

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

export function ListActions({ create, importV, exportV, districts }: { create: Verdict; importV: Verdict; exportV: Verdict; districts: string[] }) {
  const imp = useRun("importCsv", null), exp = useRun("exportCsv", null);
  return (
    <>
      <Gated v={importV}><Button size="sm" onClick={() => imp.run({})} disabled={imp.pending}><Upload />Import CSV</Button></Gated>
      <Gated v={exportV}><Button size="sm" onClick={() => exp.run({})} disabled={exp.pending}><Download />Export</Button></Gated>
      <FormDialog v={create} kind="createAccount" accountId={null} title="Add a law firm" description="Creates a prospect. We check for duplicates on firm name + district." submit="Add firm"
        trigger={<Button size="sm" variant="primary"><Building2 />Add firm</Button>}>
        <Lbl t="Firm name"><input name="name" required className={field} placeholder="e.g. Vaigai Advocates" /></Lbl>
        <div className="grid grid-cols-2 gap-3">
          <Lbl t="District"><select name="district" className={field}>{districts.map((d) => <option key={d}>{d}</option>)}</select></Lbl>
          <Lbl t="Lawyers"><input name="lawyers" type="number" min={1} defaultValue={6} className={field} /></Lbl>
        </div>
        <Lbl t="Main court"><select name="court" className={field}>{["Madras High Court", "Madras High Court, Madurai Bench", "City Civil Court, Chennai", "Principal District Court"].map((c) => <option key={c}>{c}</option>)}</select></Lbl>
      </FormDialog>
    </>
  );
}

export function DetailActions({ accountId, firm, addContact, createDeal, logActivity, seats, plan }: {
  accountId: string; firm: string; addContact: Verdict; createDeal: Verdict; logActivity: Verdict; seats: number; plan: string;
}) {
  return (
    <>
      <FormDialog v={logActivity} kind="logActivity" accountId={accountId} title="Log activity" description={firm} submit="Log"
        trigger={<Button size="sm"><NotebookPen />Log activity</Button>}>
        <Lbl t="Type"><select name="kind" className={field}>{["Call", "Meeting at firm", "Note", "WhatsApp (outside CRM)"].map((k) => <option key={k}>{k}</option>)}</select></Lbl>
        <Lbl t="Notes"><textarea name="notes" className={field + " h-20 py-2"} defaultValue="Met office manager; partners meet on Saturday to decide." /></Lbl>
      </FormDialog>
      <FormDialog v={addContact} kind="addContact" accountId={accountId} title="Add contact" description={`${firm} · phone and email are visible only to roles that can see personal data`} submit="Add contact"
        trigger={<Button size="sm"><UserPlus />Add contact</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Lbl t="Name"><input name="name" required className={field} placeholder="Adv. K. Senthil" /></Lbl>
          <Lbl t="Role at firm"><select name="title" className={field}>{["Managing Partner", "Senior Advocate", "Partner", "Associate", "Office Manager", "Clerk"].map((t) => <option key={t}>{t}</option>)}</select></Lbl>
          <Lbl t="Mobile"><input name="phone" inputMode="tel" className={field} placeholder="+91 98xxx xxxxx" /></Lbl>
          <Lbl t="Email"><input name="email" type="email" className={field} placeholder="name@firm.in" /></Lbl>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" name="decision" className="size-4 accent-[var(--accent)]" />Decision maker</label>
      </FormDialog>
      <FormDialog v={createDeal} kind="createDeal" accountId={accountId} title="Open a deal" description={`${firm} · starts in Discovery`} submit="Open deal"
        trigger={<Button size="sm" variant="primary"><FilePlus2 />Open deal</Button>}>
        <div className="grid grid-cols-2 gap-3">
          <Lbl t="Plan"><select name="plan" defaultValue={plan} className={field}>{["Practice", "Chambers", "Enterprise"].map((p) => <option key={p}>{p}</option>)}</select></Lbl>
          <Lbl t="Seats (advocates)"><input name="seats" type="number" min={1} defaultValue={seats} className={field} /></Lbl>
        </div>
        <Lbl t="Expected close"><input name="close" type="date" defaultValue="2026-11-14" className={field} /></Lbl>
      </FormDialog>
    </>
  );
}
