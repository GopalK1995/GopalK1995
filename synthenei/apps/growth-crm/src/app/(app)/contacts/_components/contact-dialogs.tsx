"use client";
// Contact create / edit / remove / export. Versioned writes with the conflict banner, like the account dialogs.
import { useTransition } from "react";
import { Download, Pencil, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useVocab } from "@/components/shell/providers";
import { Gated } from "../../accounts/_components/gated";
import type { Verdict } from "../../accounts/_components/perms";
import { Lbl, Shell, field, str, useWrite, type Option } from "../../accounts/_components/record-actions";
import { at } from "../../accounts/_lib/strings";
import { createContact, deleteContact, exportContacts, updateContact } from "../actions";

export type EditableContact = { id: string; version: number; fullName: string; roleTitle: string; email: string; phone: string; accountId: string | null; isDecisionMaker: boolean };

function Fields({ w, t, c, accounts, lockAccount }: { w: ReturnType<typeof useWrite>; t: ReturnType<typeof at>; c?: EditableContact; accounts: Option[]; lockAccount?: boolean }) {
  return (
    <>
      <Lbl t={t("ui.contactName")} issue={w.issues.fullName}><input name="fullName" required maxLength={120} defaultValue={c?.fullName} className={field} /></Lbl>
      <div className="grid grid-cols-2 gap-3">
        <Lbl t={t("ui.contactRole")}><input name="roleTitle" maxLength={120} defaultValue={c?.roleTitle} className={field} /></Lbl>
        <Lbl t={t("ui.contactPhone")} issue={w.issues.phone}><input name="phone" inputMode="tel" maxLength={20} defaultValue={c?.phone} className={field} /></Lbl>
        <Lbl t={t("ui.contactEmail")} issue={w.issues.email}><input name="email" type="email" maxLength={200} defaultValue={c?.email} className={field} /></Lbl>
        <Lbl t={t("ui.contactAccount")}>
          <select name="accountId" className={field} defaultValue={c?.accountId ?? ""} disabled={lockAccount}>
            {!lockAccount && <option value="">-</option>}
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Lbl>
      </div>
      <label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" name="isDecisionMaker" defaultChecked={c?.isDecisionMaker} className="size-4 accent-[var(--accent)]" />{t("ui.contactDecision")}</label>
    </>
  );
}
const readForm = (f: FormData, lockedAccount?: string) => ({
  fullName: str(f, "fullName"), roleTitle: str(f, "roleTitle"), email: str(f, "email"), phone: str(f, "phone"),
  accountId: lockedAccount ?? (str(f, "accountId") || null), isDecisionMaker: f.get("isDecisionMaker") === "on",
});

/** accounts: options for the linked-account select. Pass `accountId` on an account page to lock the link to it. */
export function AddContactDialog({ v, accounts, accountId }: { v: Verdict; accounts: Option[]; accountId?: string }) {
  const t = at(useVocab());
  const w = useWrite();
  return (
    <>
      <Gated v={v}><Button size="sm" onClick={() => w.setOpen(true)} data-cy="add-contact"><UserPlus />{t("ui.contactAdd")}</Button></Gated>
      <Shell w={w} title={t("ui.contactAdd")} submit={t("ui.contactAdd")} onSubmit={(f) => w.run(() => createContact(readForm(f, accountId)))}>
        <Fields w={w} t={t} accounts={accounts} lockAccount={!!accountId} />
      </Shell>
    </>
  );
}

export function EditContactDialog({ v, c, accounts }: { v: Verdict; c: EditableContact; accounts: Option[] }) {
  const t = at(useVocab());
  const w = useWrite();
  const submit = (f: FormData) => {
    const next = readForm(f);
    const patch = Object.fromEntries(Object.entries(next).filter(([k, val]) => val !== (c[k as keyof typeof next] ?? "")));
    if (!Object.keys(patch).length) { w.close(); return; }
    w.run(() => updateContact(c.id, { expectedVersion: c.version, patch }));
  };
  return (
    <>
      <Gated v={v}><Button size="sm" variant="ghost" onClick={() => w.setOpen(true)} aria-label={`${t("ui.contactEdit")}: ${c.fullName}`} data-cy="edit-contact"><Pencil /></Button></Gated>
      <Shell w={w} title={t("ui.contactEdit")} desc={c.fullName} submit={t("ui.save")} onSubmit={submit}><Fields w={w} t={t} c={c} accounts={accounts} /></Shell>
    </>
  );
}

export function DeleteContactDialog({ v, c }: { v: Verdict; c: EditableContact }) {
  const t = at(useVocab());
  const w = useWrite();
  return (
    <>
      <Gated v={v}><Button size="sm" variant="ghost" onClick={() => w.setOpen(true)} aria-label={`${t("ui.delete")}: ${c.fullName}`} data-cy="delete-contact"><Trash2 /></Button></Gated>
      <Shell w={w} title={t("ui.delete")} desc={`${c.fullName}. ${t("ui.deleteHint")}`} submit={t("ui.delete")} danger onSubmit={() => w.run(() => deleteContact(c.id, { expectedVersion: c.version }))} />
    </>
  );
}

export function ExportContactsButton({ v, canUnmask }: { v: Verdict; canUnmask: boolean }) {
  const t = at(useVocab());
  const [pending, start] = useTransition();
  const go = (mask: boolean) => start(async () => {
    const r = await exportContacts(mask);
    toast(r.message, r.sub);
    if (r.ok && r.csv) {
      const url = URL.createObjectURL(new Blob([r.csv], { type: "text/csv" }));
      const el = document.createElement("a"); el.href = url; el.download = r.filename ?? "contacts.csv"; el.click(); URL.revokeObjectURL(url);
    }
  });
  return (
    <Gated v={v}>
      <span className="inline-flex gap-2">
        <Button size="sm" onClick={() => go(true)} disabled={pending} data-cy="export-contacts"><Download />{t("ui.export")}</Button>
        {canUnmask && <Button size="sm" variant="ghost" onClick={() => go(false)} disabled={pending} data-cy="export-contacts-unmasked">{t("ui.export")} (unmasked)</Button>}
      </span>
    </Gated>
  );
}
