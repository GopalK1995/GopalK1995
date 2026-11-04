"use client";
// Generic list for a custom object: tanstack table (DataTableV2) with columns from the viewer's layout, URL-driven filters built from
// field_defs, a sort control, saved views (private, team, workspace) and the create dialog. Values arrive already masked by the server.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Bookmark, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/controls";
import { DataTableV2, type DataTableV2Column } from "@/components/ui/data-table-v2";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form";
import { FilterBar, type FilterDef } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toast";
import { fieldColumn, numericColumnIds } from "@/components/fields/field-column";
import { FieldInput } from "@/components/fields/field-input";
import { pickLabel } from "@/components/fields/labels";
import { tIn } from "@/lib/layouts/strings";
import type { ClientField } from "@/lib/metadata/runtime";
import { columnId } from "@/lib/metadata/filters";
import { createRecord, deleteView, saveView, updateView } from "../actions";
import type { ListRow, SavedView, SortSpec, ViewVisibility } from "../../_lib/types";

export interface ListViewProps {
  objectKey: string; locale: "en" | "ta"; strings: Record<string, string>; demo: boolean;
  noun: { one: string; many: string }; primaryLabel: string;
  rows: ListRow[]; truncated: boolean; /** Visible custom fields (columns, sort, filters). */ fields: ClientField[]; columnIds: string[];
  /** Fields the viewer may set on a new record (primary first). */
  formFields: ClientField[]; filterDefs: FilterDef[];
  views: (SavedView & { canEdit: boolean })[]; activeViewId: string | null;
  current: { filters: Record<string, { op: string; value: string | string[] }>; sort: SortSpec[]; columns: string[] };
  canWrite: boolean; canShare: boolean; hasAnyRecords: boolean;
}

const sortParam = (s: SortSpec[]) => (s[0] ? `${s[0].id}:${s[0].desc ? "desc" : "asc"}` : "");

export function ListView(p: ListViewProps) {
  const router = useRouter(), path = usePathname(), sp = useSearchParams();
  const t = tIn(p.strings);
  const tn = (k: string, v: Record<string, string | number> = {}) => t(k, { noun: p.noun.one, nouns: p.noun.many, ...v });
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ view: (SavedView & { canEdit: boolean }) | null } | null>(null);
  const [vName, setVName] = useState("");
  const [vVis, setVVis] = useState<ViewVisibility>("private");
  const [vErr, setVErr] = useState<string | null>(null);

  const byKey = useMemo(() => new Map(p.fields.map((f) => [columnId(f.key), f])), [p.fields]);
  const cols = useMemo<DataTableV2Column<ListRow>[]>(() => {
    const out: DataTableV2Column<ListRow>[] = [];
    for (const id of p.columnIds) {
      if (id === "title") {
        out.push({ id: "title", header: p.primaryLabel, accessorFn: (r: ListRow) => r.title, cell: (c: { row: { original: ListRow } }) => (
          <Link href={`${path}/${c.row.original.id}`} className="font-medium text-ink underline-offset-4 hover:underline" onClick={(e) => e.stopPropagation()}>{c.row.original.title || "–"}</Link>
        ) } as DataTableV2Column<ListRow>);
        continue;
      }
      const f = byKey.get(id);
      if (f) out.push(fieldColumn<ListRow>(f, { locale: p.locale }));
    }
    return out;
  }, [p.columnIds, byKey, p.locale, p.primaryLabel, path]);

  const sortable = p.columnIds.filter((id) => id === "title" || byKey.has(id));
  const labelOf = (id: string) => (id === "title" ? p.primaryLabel : pickLabel(byKey.get(id)!.label, p.locale));
  const sortOpts = [{ value: "", label: t("sortDefault") }, ...sortable.flatMap((id) => [{ value: `${id}:asc`, label: `${labelOf(id)} (${t("sortAsc")})` }, { value: `${id}:desc`, label: `${labelOf(id)} (${t("sortDesc")})` }])];
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp.toString()); if (v) n.set(k, v); else n.delete(k); router.replace(`${path}${n.toString() ? `?${n}` : ""}`, { scroll: false }); };

  const openCreate = () => {
    setDraft(Object.fromEntries(p.formFields.filter((f) => f.default !== null && f.default !== undefined).map((f) => [f.key, f.default])));
    setIssues({}); setFormErr(null); setCreating(true);
  };
  const submitCreate = () => start(async () => {
    const r = await createRecord({ objectKey: p.objectKey, values: draft });
    if (r.ok) { toast(r.message, r.sub); setCreating(false); router.refresh(); return; }
    const m: Record<string, string> = {};
    for (const i of r.issues ?? []) m[i.path] = i.message;
    setIssues(m); setFormErr(`${r.message}${r.sub ? ` ${r.sub}` : ""}`);
  });

  const openSave = (view: (SavedView & { canEdit: boolean }) | null) => { setSaving({ view }); setVName(view?.name ?? ""); setVVis(view?.visibility ?? "private"); setVErr(null); };
  const submitView = () => start(async () => {
    const cur = saving?.view;
    const r = cur
      ? await updateView({ objectKey: p.objectKey, id: cur.id, name: vName, visibility: vVis })
      : await saveView({ objectKey: p.objectKey, name: vName, visibility: vVis, filters: p.current.filters, sort: p.current.sort, columns: p.columnIds });
    if (r.ok) {
      toast(r.message, r.sub); setSaving(null);
      if (!cur && r.data?.view) setParam("view", r.data.view.id);
      router.refresh();
    } else setVErr(`${r.message}${r.sub ? ` ${r.sub}` : ""}`);
  });
  const removeView = (v: SavedView) => start(async () => {
    const r = await deleteView({ objectKey: p.objectKey, id: v.id });
    toast(r.message, r.sub);
    if (r.ok) { if (p.activeViewId === v.id) setParam("view", ""); setSaving(null); router.refresh(); }
  });

  const filtered = !!(sp.get("q") || p.filterDefs.some((f) => sp.get(f.key)) || [...sp.keys()].some((k) => k.startsWith("custom.")));
  const activeView = p.views.find((v) => v.id === p.activeViewId) ?? null;
  const create = p.canWrite ? <Button variant="primary" size="sm" onClick={openCreate}><Plus aria-hidden />{tn("newRecord")}</Button> : null;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t("viewsLabel")}>
        <Link href={path} aria-current={!p.activeViewId ? "page" : undefined} className={`h-7 rounded-control border px-2.5 text-13 leading-7 ${!p.activeViewId ? "border-accent font-medium text-ink" : "border-line-strong text-ink-2 hover:text-ink"}`}>{t("viewAll")}</Link>
        {p.views.map((v) => (
          <Link key={v.id} href={`${path}?view=${v.id}`} aria-current={v.id === p.activeViewId ? "page" : undefined} className={`inline-flex h-7 items-center gap-1 rounded-control border px-2.5 text-13 ${v.id === p.activeViewId ? "border-accent font-medium text-ink" : "border-line-strong text-ink-2 hover:text-ink"}`}>
            {v.name}{v.visibility !== "private" && <span className="text-11 text-ink-3">{t(`vis_${v.visibility}`)}</span>}
          </Link>
        ))}
        <Button variant="quiet" size="sm" onClick={() => openSave(null)}><Bookmark aria-hidden />{t("saveView")}</Button>
        {activeView?.canEdit && <Button variant="ghost" size="sm" onClick={() => openSave(activeView)}>{t("manageView")}</Button>}
        <span className="ml-auto">{create}</span>
      </div>

      <FilterBar search={tn("searchPlaceholder")} filters={p.filterDefs}>
        <label className="flex items-center gap-1.5 text-12 text-ink-2">{t("sortLabel")}
          <Select aria-label={t("sortLabel")} className="min-w-44" value={sortParam(p.current.sort) || "__none__"} onValueChange={(v) => setParam("sort", v === "__none__" ? "" : v)} options={sortOpts.map((o) => (o.value === "" ? { ...o, value: "__none__" } : o))} />
        </label>
      </FilterBar>

      {!p.hasAnyRecords ? (
        <EmptyState title={tn("emptyTitle")} body={p.canWrite ? tn("emptyBody") : tn("emptyBodyReadOnly")} action={create ?? undefined} />
      ) : (
        <DataTableV2<ListRow>
          data={p.rows} columns={cols} getRowId={(r) => r.id} caption={tn("tableCaption")} numericColumns={numericColumnIds(p.fields.filter((f) => p.columnIds.includes(columnId(f.key))))}
          onRowClick={(r) => router.push(`${path}/${r.id}`)}
          empty={{ title: filtered || activeView ? t("noMatchTitle") : tn("emptyTitle"), body: t("noMatchBody") }}
        />
      )}
      {p.truncated && <p className="text-12 text-ink-3">{t("truncated", { n: p.rows.length })}</p>}
      {p.demo && <p className="text-12 text-ink-3">{t("demoList")}</p>}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title={tn("createRecordTitle")} description={p.demo ? t("demoNotSaved") : undefined}>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); submitCreate(); }} noValidate>
            {p.formFields.map((f) => (
              <FieldInput key={f.key} def={f} value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} error={issues[f.key]} locale={p.locale} />
            ))}
            {formErr && <p role="alert" className="state-danger rounded-control border px-3 py-2 text-13">{formErr}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="quiet" onClick={() => setCreating(false)}>{t("cancel")}</Button>
              <Button type="submit" variant="primary" disabled={pending}>{pending ? t("saving") : tn("createRecordSubmit")}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!saving} onOpenChange={(o) => { if (!o) setSaving(null); }}>
        <DialogContent title={saving?.view ? t("manageViewTitle") : t("saveViewTitle")} description={saving?.view ? undefined : t("saveViewBody")}>
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (vName.trim()) submitView(); }}>
            <Field label={t("viewName")} required><Input value={vName} onChange={(e) => setVName(e.target.value)} maxLength={80} /></Field>
            <Field label={t("viewVisibility")} help={p.canShare ? undefined : t("viewShareDenied")}>
              {(c) => <Select id={c.id} value={vVis} onValueChange={(v) => setVVis(v as ViewVisibility)} options={(["private", "team", "workspace"] as ViewVisibility[]).map((v) => ({ value: v, label: t(`visDesc_${v}`), disabled: v !== "private" && !p.canShare }))} />}
            </Field>
            {vErr && <p role="alert" className="state-danger rounded-control border px-3 py-2 text-13">{vErr}</p>}
            <div className="flex items-center justify-between gap-2">
              {saving?.view ? <Button type="button" variant="danger" disabled={pending} onClick={() => removeView(saving.view!)}><Trash2 aria-hidden />{t("deleteView")}</Button> : <span />}
              <span className="flex gap-2">
                <Button type="button" variant="quiet" onClick={() => setSaving(null)}>{t("cancel")}</Button>
                <Button type="submit" variant="primary" disabled={pending || !vName.trim()}>{pending ? t("saving") : t("save")}</Button>
              </span>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
