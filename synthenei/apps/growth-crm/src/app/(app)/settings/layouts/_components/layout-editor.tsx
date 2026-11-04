"use client";
// Layout editor for one object: choose kind (record page or list), scope (all workspaces or this one) and an optional role, then arrange
// sections and fields (detail) or columns (list). Reordering uses buttons, so it is keyboard operable. Saving sends the version the page
// loaded; a stale version is a conflict and the person reloads instead of overwriting. "Use the default" removes the override.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, Switch } from "@/components/ui/controls";
import { Field, Input } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import type { LayoutScope } from "@/lib/layouts/resolve";
import { TITLE_COLUMN, type DetailSpec, type LayoutKind, type LayoutSpec, type ListSpec } from "@/lib/layouts/spec";
import { tIn } from "@/lib/layouts/strings";
import { resetLayoutAction, saveLayoutAction } from "../actions";

interface FieldRef { key: string; label: string; type: string }
export interface LayoutEditorProps {
  demo: boolean; locale: "en" | "ta"; strings: Record<string, string>;
  objects: { key: string; label: string }[]; objectKey: string; kind: LayoutKind; scope: "org" | "workspace"; roleId: string | null; roles: { id: string; name: string }[];
  fields: FieldRef[]; primaryKey: string; initial: LayoutSpec; version: number; hasOverride: boolean; inheritedFrom: LayoutScope | null;
  overrides: { kind: LayoutKind; scope: "org" | "workspace"; roleId: string | null; roleName: string | null }[];
}

const move = <T,>(a: T[], i: number, d: -1 | 1): T[] => { const j = i + d; if (j < 0 || j >= a.length) return a; const n = [...a]; [n[i], n[j]] = [n[j], n[i]]; return n; };
const ALL = "__all__";

export function LayoutEditor(p: LayoutEditorProps) {
  const router = useRouter();
  const t = tIn(p.strings);
  const [pending, start] = useTransition();
  const [detail, setDetail] = useState<DetailSpec>(p.kind === "detail" ? (p.initial as DetailSpec) : { sections: [], showRelated: true, showComments: true });
  const [cols, setCols] = useState<string[]>(p.kind === "list" ? (p.initial as ListSpec).columns : [TITLE_COLUMN]);
  const [err, setErr] = useState<{ text: string; issues: string[] } | null>(null);
  const labelOf = (k: string) => p.fields.find((f) => f.key === k)?.label ?? k;

  const go = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams({ object: p.objectKey, kind: p.kind, scope: p.scope, ...(p.roleId ? { role: p.roleId } : {}) });
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    router.push(`/settings/layouts?${n}`);
  };

  const placed = new Set(detail.sections.flatMap((s) => s.fields));
  const unplaced = p.fields.filter((f) => f.key !== p.primaryKey && !placed.has(f.key));
  const colKeys = new Set(cols);
  const addableCols = p.fields.filter((f) => f.key !== p.primaryKey && f.type !== "long_text" && !colKeys.has(`custom.${f.key}`));

  const spec = (): LayoutSpec => (p.kind === "detail" ? detail : { columns: cols });
  const save = () => start(async () => {
    const r = await saveLayoutAction({ objectKey: p.objectKey, kind: p.kind, scope: p.scope, roleId: p.roleId, spec: spec(), version: p.version });
    if (r.ok) { setErr(null); toast(r.message, r.sub); router.refresh(); return; }
    setErr({ text: `${r.message}${r.sub ? ` ${r.sub}` : ""}`, issues: (r.issues ?? []).map((i) => i.message) });
  });
  const reset = () => start(async () => {
    const r = await resetLayoutAction({ objectKey: p.objectKey, kind: p.kind, scope: p.scope, roleId: p.roleId, version: p.version });
    if (r.ok) { setErr(null); toast(r.message, r.sub); router.refresh(); return; }
    setErr({ text: `${r.message}${r.sub ? ` ${r.sub}` : ""}`, issues: [] });
  });

  const setSection = (i: number, patch: Partial<DetailSpec["sections"][number]>) => setDetail((d) => ({ ...d, sections: d.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  return (
    <div className="grid gap-4">
      <nav aria-label={t("layoutObjectsNav")} className="flex flex-wrap gap-1 border-b border-line">
        {p.objects.map((o) => (
          <Link key={o.key} href={`/settings/layouts?object=${o.key}`} aria-current={o.key === p.objectKey ? "page" : undefined}
            className={`-mb-px h-9 rounded-t-control border-b-2 px-3 text-13 leading-9 ${o.key === p.objectKey ? "border-accent font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>{o.label}</Link>
        ))}
      </nav>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("layoutKind")}>{(c) => <Select id={c.id} value={p.kind} onValueChange={(v) => go({ kind: v })} options={[{ value: "detail", label: t("kind_detail") }, { value: "list", label: t("kind_list") }]} />}</Field>
        <Field label={t("layoutScope")} help={t("layoutScopeHelp")}>{(c) => <Select id={c.id} value={p.scope} onValueChange={(v) => go({ scope: v })} options={[{ value: "org", label: t("scope_org") }, { value: "workspace", label: t("scope_workspace") }]} />}</Field>
        <Field label={t("layoutRole")} help={t("layoutRoleHelp")}>{(c) => <Select id={c.id} value={p.roleId ?? ALL} onValueChange={(v) => go({ role: v === ALL ? null : v })} options={[{ value: ALL, label: t("role_all") }, ...p.roles.map((r) => ({ value: r.id, label: r.name }))]} />}</Field>
      </div>

      <p role="status" className="text-13 text-ink-2">
        {p.hasOverride ? t("layoutHasOverride") : p.inheritedFrom ? t("layoutInherited", { scope: t(`resolved_${p.inheritedFrom}`) }) : t("layoutIsDefault")}
        {p.demo && <> {t("demoLayouts")}</>}
      </p>

      {p.kind === "detail" ? (
        <div className="grid gap-3">
          {detail.sections.map((s, i) => (
            <section key={s.id} aria-label={s.title || t("sectionUntitled")} className="rounded-md border border-line bg-surface p-3">
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t("sectionTitle")} className="min-w-48 flex-1"><Input value={s.title} onChange={(e) => setSection(i, { title: e.target.value })} maxLength={60} /></Field>
                <Button size="icon" variant="ghost" className="size-8" aria-label={t("sectionUp", { title: s.title })} disabled={i === 0} onClick={() => setDetail((d) => ({ ...d, sections: move(d.sections, i, -1) }))}><ArrowUp aria-hidden /></Button>
                <Button size="icon" variant="ghost" className="size-8" aria-label={t("sectionDown", { title: s.title })} disabled={i === detail.sections.length - 1} onClick={() => setDetail((d) => ({ ...d, sections: move(d.sections, i, 1) }))}><ArrowDown aria-hidden /></Button>
                <Button size="sm" variant="ghost" onClick={() => setDetail((d) => ({ ...d, sections: d.sections.filter((_, j) => j !== i) }))}><X aria-hidden />{t("sectionRemove")}</Button>
              </div>
              <ul className="mt-2 grid gap-1">
                {s.fields.map((k, fi) => (
                  <li key={k} className="flex items-center justify-between gap-2 rounded-chip px-2 py-1 text-13 hover:bg-paper">
                    <span>{labelOf(k)} <span className="num-mono text-ink-3">{k}</span></span>
                    <span className="inline-flex">
                      <Button size="icon" variant="ghost" className="size-7" aria-label={t("fieldUp", { label: labelOf(k) })} disabled={fi === 0} onClick={() => setSection(i, { fields: move(s.fields, fi, -1) })}><ArrowUp aria-hidden /></Button>
                      <Button size="icon" variant="ghost" className="size-7" aria-label={t("fieldDown", { label: labelOf(k) })} disabled={fi === s.fields.length - 1} onClick={() => setSection(i, { fields: move(s.fields, fi, 1) })}><ArrowDown aria-hidden /></Button>
                      <Button size="icon" variant="ghost" className="size-7" aria-label={t("fieldRemove", { label: labelOf(k) })} onClick={() => setSection(i, { fields: s.fields.filter((x) => x !== k) })}><X aria-hidden /></Button>
                    </span>
                  </li>
                ))}
                {s.fields.length === 0 && <li className="px-2 text-12 text-ink-3">{t("sectionEmpty")}</li>}
              </ul>
              {unplaced.length > 0 && (
                <div className="mt-2 max-w-xs">
                  <Select aria-label={t("fieldAdd", { title: s.title })} value="" placeholder={t("fieldAddPlaceholder")} onValueChange={(k) => setSection(i, { fields: [...s.fields, k] })} options={unplaced.map((f) => ({ value: f.key, label: f.label }))} />
                </div>
              )}
            </section>
          ))}
          <div><Button variant="quiet" size="sm" onClick={() => setDetail((d) => ({ ...d, sections: [...d.sections, { id: `s${Date.now().toString(36)}`, title: "", fields: [] }] }))}><Plus aria-hidden />{t("sectionAdd")}</Button></div>
          {unplaced.length > 0 && <p className="text-12 text-ink-3">{t("unplacedNote", { n: unplaced.length, fields: unplaced.map((f) => f.label).join(", ") })}</p>}
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-13"><Switch checked={detail.showRelated} onCheckedChange={(v) => setDetail((d) => ({ ...d, showRelated: v }))} />{t("showRelated")}</label>
            <label className="flex items-center gap-2 text-13"><Switch checked={detail.showComments} onCheckedChange={(v) => setDetail((d) => ({ ...d, showComments: v }))} />{t("showComments")}</label>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <ul className="grid gap-1 rounded-md border border-line bg-surface p-3">
            {cols.map((c, i) => (
              <li key={c} className="flex items-center justify-between gap-2 rounded-chip px-2 py-1 text-13 hover:bg-paper">
                <span>{c === TITLE_COLUMN ? t("colTitleLocked") : labelOf(c.slice(7))}</span>
                <span className="inline-flex">
                  <Button size="icon" variant="ghost" className="size-7" aria-label={t("fieldUp", { label: c === TITLE_COLUMN ? t("colTitleLocked") : labelOf(c.slice(7)) })} disabled={i === 0} onClick={() => setCols((x) => move(x, i, -1))}><ArrowUp aria-hidden /></Button>
                  <Button size="icon" variant="ghost" className="size-7" aria-label={t("fieldDown", { label: c === TITLE_COLUMN ? t("colTitleLocked") : labelOf(c.slice(7)) })} disabled={i === cols.length - 1} onClick={() => setCols((x) => move(x, i, 1))}><ArrowDown aria-hidden /></Button>
                  {c !== TITLE_COLUMN && <Button size="icon" variant="ghost" className="size-7" aria-label={t("fieldRemove", { label: labelOf(c.slice(7)) })} onClick={() => setCols((x) => x.filter((y) => y !== c))}><X aria-hidden /></Button>}
                </span>
              </li>
            ))}
          </ul>
          {addableCols.length > 0 && <div className="max-w-xs"><Select aria-label={t("colAdd")} value="" placeholder={t("colAddPlaceholder")} onValueChange={(k) => setCols((x) => [...x, `custom.${k}`])} options={addableCols.map((f) => ({ value: f.key, label: f.label }))} /></div>}
        </div>
      )}

      {err && (
        <div role="alert" className="state-danger rounded-control border px-3 py-2 text-13">
          <p>{err.text}</p>
          {err.issues.length > 0 && <ul className="mt-1 list-disc pl-5">{err.issues.map((m, i) => <li key={i}>{m}</li>)}</ul>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={save} disabled={pending}>{pending ? t("saving") : t("layoutSave")}</Button>
        {p.hasOverride && <Button variant="quiet" onClick={reset} disabled={pending}>{t("layoutUseDefault")}</Button>}
      </div>

      {p.overrides.length > 0 && (
        <details className="rounded-control border border-line px-3 py-2">
          <summary className="cursor-pointer text-13 font-medium text-ink">{t("overridesTitle", { n: p.overrides.length })}</summary>
          <ul className="mt-2 grid gap-1 text-13 text-ink-2">
            {p.overrides.map((o, i) => <li key={i}>{t(`kind_${o.kind}`)} · {t(`scope_${o.scope}`)} · {o.roleName ?? t("role_all")}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
