"use client";
// Custom objects ledger: one row per object with open / fields / layouts links, an enabled switch and an edit dialog; the create dialog
// takes the labels (English required, Tamil optional), an icon from the allow-list and the primary field label. The key is derived
// from the English singular label, shown before saving, and cannot be changed afterwards.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Select, Switch } from "@/components/ui/controls";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { ICON_KEYS, iconFor } from "@/lib/layouts/icons";
import { tIn } from "@/lib/layouts/strings";
import { createObject, updateObject } from "../actions";
import { deriveObjectKey } from "../_lib/schema";

export interface ObjectRowView { key: string; id: string; rev: string; icon: string; enabled: boolean; one: { en: string; ta: string }; many: { en: string; ta: string }; records: number }
export interface ObjectsViewProps { demo: boolean; strings: Record<string, string>; objects: ObjectRowView[]; allowed: boolean }

const blank = { oneEn: "", oneTa: "", manyEn: "", manyTa: "", primaryEn: "Name", primaryTa: "", icon: "box" };
type Form = typeof blank;

export function ObjectsView(p: ObjectsViewProps) {
  const router = useRouter();
  const t = tIn(p.strings);
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; row: ObjectRowView } | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [err, setErr] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});

  const open = (d: NonNullable<typeof dialog>) => {
    setErr(null); setIssues({});
    setForm(d.mode === "edit" ? { ...blank, oneEn: d.row.one.en, oneTa: d.row.one.ta, manyEn: d.row.many.en, manyTa: d.row.many.ta, icon: d.row.icon } : blank);
    setDialog(d);
  };
  const done = (r: { ok: boolean; message: string; sub?: string }) => {
    if (r.ok) { toast(r.message, r.sub); setDialog(null); router.refresh(); } else { setErr(`${r.message}${r.sub ? ` ${r.sub}` : ""}`); }
  };
  const submit = () => start(async () => {
    if (!dialog) return;
    const base = { one: { en: form.oneEn, ta: form.oneTa }, many: { en: form.manyEn, ta: form.manyTa }, icon: form.icon };
    const r = dialog.mode === "create"
      ? await createObject({ ...base, primary: { en: form.primaryEn, ta: form.primaryTa } })
      : await updateObject({ ...base, key: dialog.row.key, rev: dialog.row.rev, enabled: dialog.row.enabled });
    const m: Record<string, string> = {};
    if (!r.ok) for (const i of r.issues ?? []) m[i.path] = i.message;
    setIssues(m);
    done(r);
  });
  const toggle = (row: ObjectRowView, enabled: boolean) => start(async () => {
    const r = await updateObject({ one: row.one, many: row.many, icon: row.icon, key: row.key, rev: row.rev, enabled });
    if (r.ok) { toast(r.message, r.sub); router.refresh(); } else toast(r.message, r.sub);
  });

  const key = deriveObjectKey(form.oneEn || "");
  const valid = form.oneEn.trim() && form.manyEn.trim() && (dialog?.mode === "edit" || form.primaryEn.trim());

  return (
    <div className="grid gap-4">
      {p.demo && <p className="text-12 text-ink-3">{t("demoObjects")}</p>}
      {!p.allowed && <p role="status" className="state-warn rounded-control border px-3 py-2 text-13">{t("policyOff")}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-13 text-ink-2">{t("objectsCount", { n: p.objects.length })}</p>
        <Button variant="primary" size="sm" onClick={() => open({ mode: "create" })} disabledReason={p.allowed ? undefined : t("policyOff")}><Plus aria-hidden />{t("createObject")}</Button>
      </div>

      {p.objects.length === 0 ? (
        <EmptyState title={t("objectsEmptyTitle")} body={t("objectsEmptyBody")} action={<Button variant="primary" size="sm" onClick={() => open({ mode: "create" })} disabledReason={p.allowed ? undefined : t("policyOff")}><Plus aria-hidden />{t("createObject")}</Button>} />
      ) : (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="zone-ledger w-full border-collapse" data-density="table">
            <caption className="sr-only">{t("objectsCaption")}</caption>
            <thead>
              <tr className="border-y border-line bg-paper-2">
                {["colObject", "colKey", "colRecords", "colEnabled", "colActions"].map((c) => <th key={c} scope="col" className="label-caps h-9 whitespace-nowrap text-left font-medium">{t(c)}</th>)}
              </tr>
            </thead>
            <tbody>
              {p.objects.map((o) => {
                const Icon = iconFor(o.icon);
                return (
                  <tr key={o.key} className="border-b border-line last:border-0 hover:bg-paper">
                    <td className="whitespace-nowrap"><span className="inline-flex items-center gap-2"><Icon className="size-4 text-ink-3" aria-hidden /><span className="font-semibold text-ink">{o.many.en}</span>{o.many.ta && <span className="text-ink-3">{o.many.ta}</span>}</span></td>
                    <td className="whitespace-nowrap num-mono text-ink-3">{o.key}</td>
                    <td className="whitespace-nowrap text-ink-2">{o.records}</td>
                    <td className="whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <Switch checked={o.enabled} disabled={pending} onCheckedChange={(v) => toggle(o, v)} aria-label={t("enabledSwitch", { label: o.many.en })} />
                        {!o.enabled && <Chip>{t("chipDisabled")}</Chip>}
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => open({ mode: "edit", row: o })} aria-label={t("editObject", { label: o.many.en })}><Pencil aria-hidden />{t("edit")}</Button>
                      <Link href={`/settings/fields?object=${o.key}`} className="mx-1 text-13 text-accent underline-offset-4 hover:underline">{t("linkFields")}</Link>
                      <Link href={`/settings/layouts?object=${o.key}`} className="mx-1 text-13 text-accent underline-offset-4 hover:underline">{t("linkLayouts")}</Link>
                      {o.enabled && <Link href={`/o/${o.key}`} className="mx-1 text-13 text-accent underline-offset-4 hover:underline">{t("linkOpen")}</Link>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-12 text-ink-3">{t("permissionsNote")} <Link href="/settings/roles?tab=roles" className="text-accent underline-offset-4 hover:underline">{t("permissionsLink")}</Link></p>

      <Dialog open={!!dialog} onOpenChange={(o) => { if (!o) setDialog(null); }}>
        <DialogContent title={dialog?.mode === "edit" ? t("editTitle") : t("createTitle")} description={dialog?.mode === "edit" ? t("editBody") : t("createBody")}>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (valid) submit(); }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("labelOneEn")} required error={issues["one.en"]}><Input value={form.oneEn} onChange={(e) => setForm({ ...form, oneEn: e.target.value })} maxLength={60} /></Field>
              <Field label={t("labelOneTa")}><Input value={form.oneTa} onChange={(e) => setForm({ ...form, oneTa: e.target.value })} maxLength={60} lang="ta" /></Field>
              <Field label={t("labelManyEn")} required error={issues["many.en"]}><Input value={form.manyEn} onChange={(e) => setForm({ ...form, manyEn: e.target.value })} maxLength={60} /></Field>
              <Field label={t("labelManyTa")}><Input value={form.manyTa} onChange={(e) => setForm({ ...form, manyTa: e.target.value })} maxLength={60} lang="ta" /></Field>
            </div>
            <Field label={t("labelIcon")} help={t("helpIcon")}>
              {(c) => <Select id={c.id} value={form.icon} onValueChange={(v) => setForm({ ...form, icon: v })} options={ICON_KEYS.map((k) => ({ value: k, label: t(`icon_${k}`) }))} />}
            </Field>
            {dialog?.mode === "create" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("labelPrimaryEn")} required help={t("helpPrimary")} error={issues["primary.en"]}><Input value={form.primaryEn} onChange={(e) => setForm({ ...form, primaryEn: e.target.value })} maxLength={60} /></Field>
                  <Field label={t("labelPrimaryTa")}><Input value={form.primaryTa} onChange={(e) => setForm({ ...form, primaryTa: e.target.value })} maxLength={60} lang="ta" /></Field>
                </div>
                <p className="text-12 text-ink-3">{t("keyPreview", { key })}</p>
                {issues.key && <p role="alert" className="text-12 text-danger">{issues.key}</p>}
              </>
            )}
            {err && <p role="alert" className="state-danger rounded-control border px-3 py-2 text-13">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="quiet" onClick={() => setDialog(null)}>{t("cancel")}</Button>
              <Button type="submit" variant="primary" disabled={pending || !valid}>{pending ? t("saving") : dialog?.mode === "edit" ? t("save") : t("createObject")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
