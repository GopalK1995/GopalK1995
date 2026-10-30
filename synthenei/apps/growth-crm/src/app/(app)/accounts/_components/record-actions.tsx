"use client";
// Persisted account actions: add, edit, reassign, merge, remove, export. Each write sends the version the page rendered;
// a stale write returns code "conflict" and the dialog shows the conflict banner instead of overwriting. "Saved" toasts
// come only from an ok result (the server returns it after the commit).
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Building2, Download, GitMerge, Pencil, Trash2, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { useVocab } from "@/components/shell/providers";
import { ConflictBanner } from "../../leads/_components/conflict-banner";
import { Gated } from "./gated";
import type { Verdict } from "./perms";
import { at } from "../_lib/strings";
import { assignAccountOwner, createAccount, deleteAccount, exportAccounts, mergeAccounts, updateAccount } from "../persisted";

export const field = "h-9 w-full rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] outline-none focus:border-ring";
export type Option = { id: string; name: string };
export type EditableAccount = { id: string; version: number; name: string; city: string; district: string; website: string; ownerId: string | null };

type Res = { ok: boolean; message: string; sub?: string; code?: string; issues?: { path: string; message: string }[] };
export type Write = ReturnType<typeof useWrite>;

/** Dialog state + submit transition shared by every account write. */
export function useWrite() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const close = () => { setOpen(false); setErr(null); setConflict(false); setIssues({}); };
  const run = (call: () => Promise<Res>, after?: () => void) => start(async () => {
    const r = await call();
    if (!r.ok) {
      setConflict(r.code === "conflict");
      setErr(r.code === "conflict" ? null : r.message);
      setIssues(Object.fromEntries((r.issues ?? []).map((i) => [i.path, i.message])));
      return;
    }
    toast(r.message, r.sub); close(); after?.(); router.refresh();
  });
  return { open, setOpen, pending, err, conflict, issues, close, run };
}

export function Shell({ w, title, desc, children, submit, onSubmit, danger }: { w: Write; title: string; desc?: string; children?: ReactNode; submit: string; onSubmit: (f: FormData) => void; danger?: boolean }) {
  const t = at(useVocab());
  return (
    <Dialog open={w.open} onOpenChange={(o) => !o && w.close()}>
      <DialogContent title={title} description={desc}>
        <form className="space-y-3" action={onSubmit}>
          {w.conflict && <ConflictBanner title={t("conflictTitle")} body={t("conflictBody")} reload={t("conflictReload")} onReload={w.close} />}
          {children}
          {w.err && <p role="alert" className="text-[12px] text-danger">{w.err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={w.close}>{t("ui.cancel")}</Button>
            <Button variant={danger ? "danger" : "primary"} disabled={w.pending} data-cy="account-submit">{w.pending ? t("ui.saving") : submit}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export const Lbl = ({ t, issue, children }: { t: string; issue?: string; children: ReactNode }) => (
  <label className="block"><span className="mb-1 block text-[12px] font-medium text-ink-2">{t}</span>{children}{issue && <span className="mt-1 block text-[12px] text-danger">{issue}</span>}</label>
);
export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const OwnerSelect = ({ owners, value, t }: { owners: Option[]; value: string; t: ReturnType<typeof at> }) => (
  <Lbl t={t("ui.owner")}><select name="ownerId" className={field} defaultValue={value}><option value="">{t("ui.unassigned")}</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Lbl>
);

function Details({ w, t, districts, a }: { w: Write; t: ReturnType<typeof at>; districts: string[]; a?: EditableAccount }) {
  return (
    <>
      <Lbl t={t("ui.name")} issue={w.issues.name}><input name="name" required maxLength={160} defaultValue={a?.name} className={field} aria-invalid={!!w.issues.name} /></Lbl>
      <div className="grid grid-cols-2 gap-3">
        <Lbl t={t("ui.city")}><input name="city" maxLength={80} defaultValue={a?.city} className={field} /></Lbl>
        <Lbl t={t("ui.district")}>
          <input name="district" list="acc-districts" maxLength={80} defaultValue={a?.district} className={field} />
          <datalist id="acc-districts">{districts.map((d) => <option key={d} value={d} />)}</datalist>
        </Lbl>
        <Lbl t={t("ui.website")}><input name="website" maxLength={200} defaultValue={a?.website} className={field} /></Lbl>
      </div>
    </>
  );
}

export function CreateAccountDialog({ v, owners, districts }: { v: Verdict; owners: Option[]; districts: string[] }) {
  const t = at(useVocab());
  const w = useWrite();
  const submit = (f: FormData) => w.run(() => createAccount({ name: str(f, "name"), city: str(f, "city"), district: str(f, "district"), website: str(f, "website"), ownerId: str(f, "ownerId") || null }));
  return (
    <>
      <Gated v={v}><Button size="sm" variant="primary" onClick={() => w.setOpen(true)} data-cy="create-account"><Building2 />{t("ui.add")}</Button></Gated>
      <Shell w={w} title={t("ui.add")} submit={t("ui.add")} onSubmit={submit}>
        <Details w={w} t={t} districts={districts} />
        <OwnerSelect owners={owners} value="" t={t} />
      </Shell>
    </>
  );
}

export function EditAccountDialog({ v, a, districts }: { v: Verdict; a: EditableAccount; districts: string[] }) {
  const t = at(useVocab());
  const w = useWrite();
  const submit = (f: FormData) => {
    const next = { name: str(f, "name"), city: str(f, "city"), district: str(f, "district"), website: str(f, "website") };
    const patch = Object.fromEntries(Object.entries(next).filter(([k, val]) => val !== (a[k as keyof typeof next] ?? "")));
    if (!Object.keys(patch).length) { w.close(); return; }
    w.run(() => updateAccount(a.id, { expectedVersion: a.version, patch }));
  };
  return (
    <>
      <Gated v={v}><Button size="sm" onClick={() => w.setOpen(true)} data-cy="edit-account"><Pencil />{t("ui.edit")}</Button></Gated>
      <Shell w={w} title={t("ui.editTitle")} desc={a.name} submit={t("ui.save")} onSubmit={submit}><Details w={w} t={t} districts={districts} a={a} /></Shell>
    </>
  );
}

export function AssignAccountDialog({ v, a, owners }: { v: Verdict; a: EditableAccount; owners: Option[] }) {
  const t = at(useVocab());
  const w = useWrite();
  const submit = (f: FormData) => w.run(() => assignAccountOwner(a.id, { expectedVersion: a.version, ownerId: str(f, "ownerId") || null }));
  return (
    <>
      <Gated v={v}><Button size="sm" onClick={() => w.setOpen(true)} data-cy="assign-account"><UserCog />{t("ui.assign")}</Button></Gated>
      <Shell w={w} title={t("ui.assignTitle")} desc={a.name} submit={t("ui.save")} onSubmit={submit}><OwnerSelect owners={owners} value={a.ownerId ?? ""} t={t} /></Shell>
    </>
  );
}

export function MergeAccountDialog({ v, a, targets }: { v: Verdict; a: EditableAccount; targets: (Option & { version: number })[] }) {
  const t = at(useVocab());
  const w = useWrite();
  const submit = (f: FormData) => {
    const target = targets.find((x) => x.id === str(f, "targetId"));
    if (!target) return;
    w.run(() => mergeAccounts(a.id, { targetId: target.id, sourceVersion: a.version, targetVersion: target.version }));
  };
  const others = targets.filter((x) => x.id !== a.id);
  return (
    <>
      <Gated v={v}><Button size="sm" onClick={() => w.setOpen(true)} data-cy="merge-account"><GitMerge />{t("ui.merge")}</Button></Gated>
      <Shell w={w} title={t("ui.mergeTitle")} desc={t("ui.mergeHint")} submit={t("ui.merge")} onSubmit={submit} danger>
        <Lbl t={a.name}><select name="targetId" required className={field} defaultValue="">
          <option value="" disabled>{t("ui.merge")}…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Lbl>
      </Shell>
    </>
  );
}

export function DeleteAccountDialog({ v, a }: { v: Verdict; a: EditableAccount }) {
  const t = at(useVocab());
  const w = useWrite();
  const router = useRouter();
  return (
    <>
      <Gated v={v}><Button size="sm" variant="danger" onClick={() => w.setOpen(true)} data-cy="delete-account"><Trash2 />{t("ui.delete")}</Button></Gated>
      <Shell w={w} title={t("ui.deleteTitle")} desc={`${a.name}. ${t("ui.deleteHint")}`} submit={t("ui.delete")} danger
        onSubmit={() => w.run(() => deleteAccount(a.id, { expectedVersion: a.version }), () => router.push("/accounts"))} />
    </>
  );
}

export function ExportAccountsButton({ v }: { v: Verdict }) {
  const t = at(useVocab());
  const [pending, start] = useTransition();
  const go = () => start(async () => {
    const r = await exportAccounts();
    toast(r.message, r.sub);
    if (r.ok && r.csv) {
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv" }));
      const el = document.createElement("a"); el.href = url; el.download = r.filename ?? "accounts.csv"; el.click(); URL.revokeObjectURL(url);
    }
  });
  return <Gated v={v}><Button size="sm" onClick={go} disabled={pending} data-cy="export-accounts"><Download />{t("ui.export")}</Button></Gated>;
}
