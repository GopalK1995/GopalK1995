"use client";
// Field ledger for one object: ordered list with type, rules, who sees/edits, and the actions (edit, move, retire).
// Ledger zone: 36 px rows, 12 px type. Reordering uses buttons (keyboard operable), not drag only.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { pickLabel } from "@/components/fields/labels";
import { tIn, type FieldsLocale } from "@/lib/metadata/strings";
import type { FieldDef } from "@/lib/metadata/types";
import { moveField, restoreField, retireField } from "../actions";
import { FieldEditor } from "./field-editor";

export interface FieldsViewProps {
  demo: boolean; locale: FieldsLocale; strings: Record<string, string>;
  objects: { key: string; one: string; many: string; custom: boolean }[];
  objectKey: string; fields: FieldDef[]; limit: { max: number | null; used: number };
  roles: { value: string; label: string }[];
}

export function FieldsView(p: FieldsViewProps) {
  const router = useRouter();
  const t = tIn(p.strings);
  const [pending, start] = useTransition();
  const [editor, setEditor] = useState<{ field: FieldDef | null } | null>(null);
  const [retiring, setRetiring] = useState<FieldDef | null>(null);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const active = p.fields.filter((f) => !f.archivedAt).sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
  const retired = p.fields.filter((f) => f.archivedAt);
  const atLimit = p.limit.max !== null && p.limit.used >= p.limit.max;
  const obj = p.objects.find((o) => o.key === p.objectKey);
  const done = () => router.refresh();

  const run = (fn: () => Promise<{ ok: boolean; message: string; sub?: string; code?: string }>) => start(async () => {
    const r = await fn();
    if (r.ok) { setErr(null); toast(r.message, r.sub); done(); } else setErr(`${r.message}${r.sub ? ` ${r.sub}` : ""}`);
  });
  const who = (f: FieldDef) => {
    const v = f.options.access?.viewRoles ?? [], e = f.options.access?.editRoles ?? [];
    const names = (l: string[]) => l.map((r) => p.roles.find((x) => x.value === r)?.label ?? r).join(", ");
    return `${v.length ? t("seenBy", { roles: names(v) }) : t("seenByAll")}${e.length ? `, ${t("editedBy", { roles: names(e) })}` : ""}`;
  };

  return (
    <div className="grid gap-4">
      <nav aria-label={t("objectsNav")} className="flex flex-wrap gap-1 border-b border-line">
        {p.objects.map((o) => (
          <Link key={o.key} href={`/settings/fields?object=${o.key}`} aria-current={o.key === p.objectKey ? "page" : undefined}
            className={`-mb-px h-9 rounded-t-control border-b-2 px-3 text-13 leading-9 ${o.key === p.objectKey ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {o.many.charAt(0).toUpperCase() + o.many.slice(1)}
          </Link>
        ))}
      </nav>

      {p.demo && <p className="text-12 text-ink-3">{t("demoEditor")}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-13 text-ink-2">{p.limit.max === null ? t("countNoLimit", { n: p.limit.used }) : t("countOfLimit", { n: p.limit.used, max: p.limit.max })}</p>
        <Button variant="primary" size="sm" onClick={() => setEditor({ field: null })} disabledReason={atLimit ? t("limitReached", { max: p.limit.max ?? 0 }) : undefined}><Plus aria-hidden />{t("addField")}</Button>
      </div>
      {err && <p role="alert" className="state-danger rounded-control border px-3 py-2 text-13">{err}</p>}

      {active.length === 0 ? (
        <EmptyState title={t("emptyTitle", { nouns: obj?.many ?? "" })} body={t("emptyBody", { noun: obj?.one ?? "" })} action={<Button variant="primary" size="sm" onClick={() => setEditor({ field: null })}><Plus aria-hidden />{t("addField")}</Button>} />
      ) : (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="zone-ledger w-full border-collapse" data-density="table">
            <caption className="sr-only">{t("tableCaption", { nouns: obj?.many ?? "" })}</caption>
            <thead>
              <tr className="border-y border-line bg-paper-2">
                {["colOrder", "colField", "colType", "colRules", "colAccess", "colActions"].map((c) => <th key={c} scope="col" className="label-caps h-9 whitespace-nowrap text-left font-medium">{t(c)}</th>)}
              </tr>
            </thead>
            <tbody>
              {active.map((f, i) => (
                <tr key={f.id} className="border-b border-line last:border-0 hover:bg-paper">
                  <td className="whitespace-nowrap">
                    <Button size="icon" variant="ghost" className="size-7" aria-label={t("moveUp", { label: f.label.en })} disabled={pending || i === 0} onClick={() => run(() => moveField({ objectKey: p.objectKey, key: f.key, delta: -1 }))}><ArrowUp aria-hidden /></Button>
                    <Button size="icon" variant="ghost" className="size-7" aria-label={t("moveDown", { label: f.label.en })} disabled={pending || i === active.length - 1} onClick={() => run(() => moveField({ objectKey: p.objectKey, key: f.key, delta: 1 }))}><ArrowDown aria-hidden /></Button>
                  </td>
                  <td className="whitespace-nowrap"><span className="font-semibold text-ink">{pickLabel(f.label, p.locale)}</span> <span className="num-mono text-ink-3">{f.key}</span></td>
                  <td className="whitespace-nowrap text-ink-2">{t(`type_${f.type}`)}</td>
                  <td className="whitespace-nowrap"><span className="inline-flex gap-1">
                    {f.required && <Chip tone="accent">{t("chipRequired")}</Chip>}
                    {f.isPii && <Chip tone="warn">{t("chipPii")}</Chip>}
                    {f.uniqueInWorkspace && <Chip>{t("chipUnique")}</Chip>}
                    {f.isFilterable && <Chip>{t("chipFilterable")}</Chip>}
                  </span></td>
                  <td className="whitespace-nowrap text-ink-2">{who(f)}</td>
                  <td className="whitespace-nowrap">
                    <Button size="sm" variant="ghost" onClick={() => setEditor({ field: f })} aria-label={t("editField", { label: f.label.en })}><Pencil aria-hidden />{t("edit")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setRetiring(f); setReason(""); setErr(null); }} aria-label={t("retireField", { label: f.label.en })}><Archive aria-hidden />{t("retire")}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {retired.length > 0 && (
        <details className="rounded-control border border-line px-3 py-2">
          <summary className="cursor-pointer text-13 font-medium text-ink">{t("retiredTitle", { n: retired.length })}</summary>
          <p className="mt-1 text-12 text-ink-3">{t("retiredBody")}</p>
          <ul className="mt-2 grid gap-1">
            {retired.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-2 text-13">
                <span><span className="text-ink-2">{pickLabel(f.label, p.locale)}</span> <span className="num-mono text-ink-3">{f.key}</span></span>
                <Button size="sm" variant="quiet" disabled={pending} onClick={() => run(() => restoreField({ objectKey: p.objectKey, key: f.key, rev: f.rev ?? "" }))}><RotateCcw aria-hidden />{t("restore")}</Button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {editor && (
        <FieldEditor key={editor.field?.key ?? "new"} open onOpenChange={(o) => { if (!o) setEditor(null); }} strings={p.strings} objectKey={p.objectKey} objects={p.objects} roles={p.roles} field={editor.field} onSaved={done} />
      )}

      <Dialog open={!!retiring} onOpenChange={(o) => { if (!o) setRetiring(null); }}>
        <DialogContent title={t("retireTitle", { label: retiring?.label.en ?? "" })} description={t("retireBody")}>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!retiring) return; const f = retiring; run(async () => { const r = await retireField({ objectKey: p.objectKey, key: f.key, rev: f.rev ?? "", reason }); if (r.ok) setRetiring(null); return r; }); }}>
            <Field label={t("reasonLabel")} help={t("reasonHelp")} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="quiet" onClick={() => setRetiring(null)}>{t("cancel")}</Button>
              <Button type="submit" variant="danger" disabled={pending || reason.trim().length < 8}>{pending ? t("saving") : t("retireConfirm")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
