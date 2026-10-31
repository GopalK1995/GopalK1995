"use client";
// <CustomFields/> client half: read-only display with an Edit mode. Props carry only what the viewer may see (masked
// fields are absent, see lib/metadata/runtime.ts). Saves send only the changed keys plus the record version the page
// rendered; a stale version comes back as a conflict and the panel offers Reload instead of overwriting.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import type { Option } from "@/components/ui/controls";
import { bySection, type ClientField } from "@/lib/metadata/runtime";
import { ft, type FieldsLocale } from "@/lib/metadata/strings";
import { saveCustomFields } from "./actions";
import { FieldInput } from "./field-input";
import { FieldValue } from "./field-value";
import { pickLabel } from "./labels";

export interface CustomFieldsPanelProps {
  objectKey: string; recordId: string; version: number;
  fields: ClientField[]; values: Record<string, unknown>; hiddenCount: number;
  locale: FieldsLocale; demo: boolean; /** noun for the object, from the tenant vocabulary */ noun: string;
  /** Whether the viewer can open the admin editor (link shown in the empty state). */
  canManage: boolean; revalidate?: string;
  /** Options for user and lookup fields, by object key ("user" for people). */
  lookups?: Record<string, Option[]>;
  /** Heading level wrapper title override. */
  title?: string;
}

type Issues = Record<string, string>;

export function CustomFieldsPanel(p: CustomFieldsPanelProps) {
  const router = useRouter();
  const [values, setValues] = useState(p.values);
  const [version, setVersion] = useState(p.version);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [issues, setIssues] = useState<Issues>({});
  const [banner, setBanner] = useState<{ kind: "conflict" | "error"; text: string; sub?: string } | null>(null);
  const [pending, start] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const t = (k: string, v: Record<string, string | number> = {}) => ft(k, { noun: p.noun, ...v }, p.locale);
  const editable = p.fields.some((f) => f.edit);
  const optsFor = (f: ClientField): Option[] | undefined => (f.type === "user" ? p.lookups?.user : f.lookupObject ? p.lookups?.[f.lookupObject] : undefined);
  const nameOf = (f: ClientField) => (id: string) => optsFor(f)?.find((o) => o.value === id)?.label;

  const begin = () => { setDraft({ ...values }); setIssues({}); setBanner(null); };
  const cancel = () => { setDraft(null); setIssues({}); setBanner(null); };
  const save = () => {
    if (!draft) return;
    const patch: Record<string, unknown> = {};
    for (const f of p.fields) if (f.edit && JSON.stringify(draft[f.key] ?? null) !== JSON.stringify(values[f.key] ?? null)) patch[f.key] = draft[f.key] ?? null;
    if (!Object.keys(patch).length) { cancel(); return; }
    start(async () => {
      const res = await saveCustomFields({ objectKey: p.objectKey, recordId: p.recordId, expectedVersion: version, patch, revalidate: p.revalidate });
      if (res.ok) {
        setValues(res.data?.values ?? { ...values, ...patch }); setVersion(res.data?.version ?? version); setDraft(null); setIssues({}); setBanner(null);
        toast(res.message, res.sub);
        return;
      }
      if (res.code === "conflict") { setBanner({ kind: "conflict", text: res.message, sub: res.sub }); return; }
      const map: Issues = {};
      for (const i of res.issues ?? []) map[i.path] = i.message;
      setIssues(map);
      setBanner({ kind: "error", text: res.message, sub: res.sub });
      const first = p.fields.find((f) => map[f.key]);
      if (first) requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-field="${first.key}"] input, [data-field="${first.key}"] textarea, [data-field="${first.key}"] button`)?.focus());
    });
  };

  if (!p.fields.length) {
    return (
      <section aria-label={p.title ?? t("sectionTitle")} className="zone-working grid gap-1">
        <h3 className="text-15 font-bold">{p.title ?? t("sectionTitle")}</h3>
        <p className="text-13 text-ink-2">{t("panelEmpty")}</p>
        {p.hiddenCount > 0 && <p className="text-12 text-ink-3">{t("hiddenForRole", { n: p.hiddenCount })}</p>}
        {p.canManage && <a href="/settings/fields" className="w-fit text-13 text-accent underline-offset-2 hover:underline">{t("openEditor")}</a>}
      </section>
    );
  }

  const groups = bySection(p.fields);
  return (
    <section ref={root} aria-label={p.title ?? t("sectionTitle")} aria-busy={pending} className="zone-working grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-15 font-bold">{p.title ?? t("sectionTitle")}</h3>
        {draft ? (
          <div className="flex gap-2">
            <Button size="sm" variant="quiet" onClick={cancel} disabled={pending}>{t("cancel")}</Button>
            <Button size="sm" variant="primary" onClick={save} disabled={pending}>{pending ? t("saving") : t("save")}</Button>
          </div>
        ) : (
          <Button size="sm" variant="quiet" onClick={begin} disabledReason={editable ? undefined : t("cannotEdit")}><Pencil aria-hidden />{t("edit")}</Button>
        )}
      </div>
      {p.demo && <p className="text-12 text-ink-3">{t("demoFields")}</p>}
      {banner && (
        <div role="alert" className="state-warn flex items-start gap-2 rounded-control border px-3 py-2 text-13">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="grid gap-0.5"><strong className="font-semibold">{banner.text}</strong>{banner.sub && <span>{banner.sub}</span>}</div>
          {banner.kind === "conflict" && <Button size="sm" variant="quiet" className="ml-auto" onClick={() => router.refresh()}>{t("reload")}</Button>}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.section || "_"} className="grid gap-2">
          {g.section && <h4 className="label-caps">{g.section}</h4>}
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {g.fields.map((f) => (
              <div key={f.key} data-field={f.key} className={f.type === "long_text" ? "sm:col-span-2" : undefined}>
                {draft && f.edit ? (
                  <FieldInput def={f} value={draft[f.key]} locale={p.locale} options={optsFor(f)} error={issues[f.key]} disabled={pending}
                    onChange={(v) => setDraft((d) => ({ ...(d ?? {}), [f.key]: v }))} />
                ) : (
                  <div className="grid gap-0.5">
                    <span className="text-12 text-ink-3">{pickLabel(f.label, p.locale)}{f.isPii && <span className="sr-only"> ({t("piiNote")})</span>}</span>
                    <span className="text-13 text-ink"><FieldValue def={f} value={values[f.key]} locale={p.locale} resolve={nameOf(f)} /></span>
                    {draft && !f.edit && <span className="text-12 text-ink-3">{t("readOnlyField")}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {p.hiddenCount > 0 && <p className="text-12 text-ink-3">{t("hiddenForRole", { n: p.hiddenCount })}</p>}
    </section>
  );
}

export function CustomFieldsSkeleton() {
  return <div className="zone-working grid gap-2" aria-busy="true" aria-label="Loading"><div className="h-4 w-32 rounded-chip bg-paper-2" /><div className="h-8 rounded-control bg-paper-2" /><div className="h-8 rounded-control bg-paper-2" /></div>;
}
