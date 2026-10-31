// Shared audit viewer body for the org tab and the platform page: filter form (plain GET, works without JS), ledger table,
// keyset paging links and every screen state (empty, filtered-empty, error, partial, permission-denied). Server component.
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, ErrorState, PartialState, type PartialItem } from "@/components/ui/states";
import { fmtDateTime } from "@/lib/format";
import { AUDIT_SOURCES, type AuditFilters, type AuditView } from "../types";
import type { T } from "../strings";

export type AuditScreen =
  | { kind: "ok"; rows: AuditView[]; nextCursor: string | null; partial?: { done: number; total: number; items: PartialItem[] } }
  | { kind: "error"; message?: string }
  | { kind: "denied"; body: string };

const field = "h-8 rounded-control border border-line-strong bg-surface px-2 text-13 text-ink outline-none focus:border-ring";
const lbl = "flex flex-col gap-1 text-12 text-ink-3";

function FilterForm({ t, basePath, filters, platform, fixed }: { t: T; basePath: string; filters: AuditFilters; platform: boolean; fixed?: Record<string, string> }) {
  return (
    <form method="get" action={basePath} className="flex flex-wrap items-end gap-3 border-b border-line px-4 py-3 sm:px-5" role="search" aria-label={t("title")}>
      {Object.entries(fixed ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className={lbl}>{t("filterActor")}<input name="actor" defaultValue={filters.actor ?? ""} placeholder={t("filterActorHint")} className={`${field} w-40`} /></label>
      <label className={lbl}>{t("filterAction")}<input name="action" defaultValue={filters.action ?? ""} placeholder="audit.exported" className={`${field} w-40 font-mono`} /></label>
      <label className={lbl}>{t("filterObject")}<input name="object" defaultValue={filters.object ?? ""} placeholder={t("filterObjectHint")} className={`${field} w-40 font-mono`} /></label>
      <label className={lbl}>{t("filterSource")}
        <select name="source" defaultValue={filters.source ?? ""} className={field}>
          <option value="">{t("filterSource")}</option>
          {AUDIT_SOURCES.map((s) => <option key={s} value={s}>{t(`source_${s}`)}</option>)}
        </select>
      </label>
      <label className={lbl}>{t("filterFrom")}<input type="date" name="from" defaultValue={filters.from ?? ""} className={field} /></label>
      <label className={lbl}>{t("filterTo")}<input type="date" name="to" defaultValue={filters.to ?? ""} className={field} /></label>
      {platform && <label className={lbl}>{t("filterTenant")}<input name="tenant" defaultValue={filters.tenant ?? ""} className={`${field} w-56 font-mono`} /></label>}
      {platform && <label className={lbl}>{t("filterWorkspace")}<input name="workspace" defaultValue={filters.workspace ?? ""} className={`${field} w-56 font-mono`} /></label>}
      <button type="submit" className="h-8 rounded-control bg-accent px-3 text-13 font-medium text-accent-ink hover:bg-accent-strong">{t("apply")}</button>
      <Link href={`${basePath}${query({}, undefined, fixed)}`} className="inline-flex h-8 items-center rounded-control px-2 text-13 text-ink-2 hover:bg-paper-2 hover:text-ink">{t("clear")}</Link>
    </form>
  );
}

export const hasFilters = (f: AuditFilters) => Object.values(f).some(Boolean);

function query(filters: AuditFilters, cursor?: string, fixed?: Record<string, string>) {
  const p = new URLSearchParams(fixed ?? {});
  for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
  if (cursor) p.set("cursor", cursor);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function AuditViewBody({ t, basePath, filters, screen, platform = false, piiMasked, cursor, fixed }: {
  t: T; basePath: string; filters: AuditFilters; screen: AuditScreen; platform?: boolean; piiMasked: boolean; cursor?: string; fixed?: Record<string, string>;
}) {
  if (screen.kind === "denied") return <div className="p-4 sm:p-5"><EmptyState title={t("deniedTitle")} body={screen.body} /></div>;
  if (screen.kind === "error") {
    return <div className="p-4 sm:p-5"><ErrorState source={t("errorSource")} message={screen.message ?? t("errorMessage")} retry={<Link href={`${basePath}${query(filters, cursor, fixed)}`} className="text-13 font-medium text-accent hover:underline">{t("retry")}</Link>} /></div>;
  }
  const { rows, nextCursor, partial } = screen;
  const sourceLabel = (s: string) => (t(`source_${s}`) === `source_${s}` ? s : t(`source_${s}`));
  const cols: Column<AuditView>[] = [
    { key: "at", header: t("colWhen"), mobile: "fact", cell: (a) => <span className="num text-ink-2">{fmtDateTime(a.at)}</span> },
    { key: "action", header: t("colAction"), mobile: "title", cell: (a) => (
      <span className="inline-flex items-center gap-1.5">
        {a.support && <ShieldAlert className="size-3.5 text-warn-ink" aria-label={t("supportRow")} />}
        <span className="font-mono text-12 text-ink">{a.action}</span>
      </span>
    ) },
    { key: "actor", header: t("colActor"), mobile: "fact", cell: (a) => <span>{a.actorLabel}{a.actorKind !== "user" && <span className="ml-1.5 text-12 text-ink-3">{a.actorKind.replace("_", " ")}</span>}</span> },
    { key: "summary", header: t("colSummary"), className: "max-w-[360px]", cell: (a) => <span className="block truncate text-ink-2" title={a.summary}>{a.summary}{a.reason ? <span className="text-ink-3">{` · ${a.reason}`}</span> : null}</span> },
    { key: "object", header: t("colObject"), cell: (a) => <span className="font-mono text-12 text-ink-3">{a.objectId ? `${a.objectTable}:${a.objectId.slice(0, 8)}` : a.objectTable}</span> },
    { key: "source", header: t("colSource"), cell: (a) => <Chip tone={a.support ? "warn" : "neutral"}>{sourceLabel(a.source)}</Chip> },
    ...(platform ? [{ key: "scope", header: t("colScope"), cell: (a: AuditView) => <span className="font-mono text-12 text-ink-3">{a.workspaceId ? a.workspaceId.slice(0, 8) : "platform"}</span> } as Column<AuditView>] : []),
    { key: "ip", header: t("colIp"), cell: (a) => <span className="font-mono text-12 text-ink-3">{a.ip || "-"}</span> },
  ];
  const filtered = hasFilters(filters);
  return (
    <>
      {partial && partial.done < partial.total && <div className="px-4 py-3 sm:px-5"><PartialState done={partial.done} total={partial.total} items={partial.items} noun={t("partialNoun")} /></div>}
      {rows.length === 0 ? (
        <div className="p-4 sm:p-5"><EmptyState title={filtered ? t("emptyFiltered") : t("empty")} body={filtered ? t("emptyFilteredBody") : t("emptyBody")} /></div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 px-4 py-2 text-12 text-ink-3 sm:px-5">
            <span className="num">{t("rowsShown", { n: rows.length })}</span>
            <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-bar bg-warn-soft ring-1 ring-warn/40" aria-hidden />{t("supportLegend")}</span>
          </div>
          <DataTable rows={rows} columns={cols} rowKey={(a) => a.id} minWidth={platform ? 1100 : 980} caption={t("title")} rowClassName={(a) => (a.support ? "bg-warn-soft/50 hover:bg-warn-soft" : "")} />
          <nav aria-label="Paging" className="flex items-center justify-between border-t border-line px-4 py-2.5 text-13 sm:px-5">
            {cursor ? <Link href={`${basePath}${query(filters, undefined, fixed)}`} className="font-medium text-accent hover:underline">{t("newer")}</Link> : <span />}
            {nextCursor ? <Link href={`${basePath}${query(filters, nextCursor, fixed)}`} className="font-medium text-accent hover:underline" rel="next">{t("older")}</Link> : <span />}
          </nav>
        </>
      )}
      <p className="border-t border-line px-4 py-3 text-12 text-ink-3 sm:px-5">{t("appendOnly")}{piiMasked ? ` ${t("piiMasked")}` : ""}</p>
    </>
  );
}

export function AuditCard({ t, basePath, filters, platform = false, fixed, children }: { t: T; basePath: string; filters: AuditFilters; platform?: boolean; fixed?: Record<string, string>; children: React.ReactNode }) {
  return (
    <Card>
      <FilterForm t={t} basePath={basePath} filters={filters} platform={platform} fixed={fixed} />
      {children}
    </Card>
  );
}
