"use client";
// Dense lead table with selection + bulk bar (desktop) and stacked cards below 768px.
// Personal data never reaches this component for masked roles: the server page strips it first.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Download, Mail, MessageCircle, Phone, UserRoundCheck, X } from "lucide-react";
import type { Channel, LeadStage, ScoreFactor } from "@/lib/data/types";
import { fmtDate, fmtTime } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Gate } from "@/components/ui/gate";
import { usePerm } from "./perm";
import { Tip } from "@/components/ui/tooltip";
import { ScoreChip, Empty } from "@/components/ui/misc";
import { DataGrid, type DataGridColumn } from "@/components/ui/data-grid";
import { ChannelMark, LeadStageBadge } from "@/components/ui/domain";
import { Badge } from "@/components/ui/badge";
import { toastResult } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { FieldValue } from "@/components/fields/field-value";
import { pickLabel } from "@/components/fields/labels";
import type { ClientField } from "@/lib/metadata/runtime";
import type { FieldsLocale } from "@/lib/metadata/strings";
import { assignLeads, exportLeads } from "../actions";
import { field } from "../_lib/sales";
import { useVocab } from "@/components/shell/providers";

export type LeadRow = {
  id: string; name: string; title: string; firm: string; firmId: string | null; district: string; city: string;
  channel: Channel; campaign: { id: string; name: string } | null; utm: string; stage: LeadStage; score: number; factors: ScoreFactor[];
  owner: string | null; ownerId: string | null; lastTouch: string; next: string | null; nextOverdue: boolean; sla: boolean;
  consent: { wa: boolean; email: boolean }; phone: string | null;
  /** Custom values the viewer may see (masked on the server). */
  custom?: Record<string, unknown>;
};
type Perms = { assign: boolean; exportCsv: boolean; importCsv: boolean; work: boolean };

export function ScoreWithFactors({ score, factors }: { score: number; factors: ScoreFactor[] }) {
  return (
    <Tip side="left" content={
      <span className="block w-56">
        <span className="mb-1 block font-medium">Score {score} / 100, rule-based</span>
        {factors.slice(0, 6).map((f) => (
          <span key={f.label} className="flex justify-between gap-3 num"><span className="truncate">{f.label}</span><span>{f.points > 0 ? "+" : ""}{f.points}</span></span>
        ))}
        <span className="mt-1 block text-navy-ink-3">Weights are set in AI settings.</span>
      </span>
    }>
      <button type="button" className="rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Score ${score}. Factors: ${factors.slice(0, 3).map((f) => `${f.label} ${f.points}`).join(", ")}`}>
        <ScoreChip score={score} />
      </button>
    </Tip>
  );
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click(); URL.revokeObjectURL(url);
}

export function LeadsTable({ rows, owners, perms, masked, sort, allIds, empty, customCols = [], locale = "en" }: {
  rows: LeadRow[]; owners: { id: string; name: string }[]; perms: Perms; masked: boolean; sort: string; allIds: string[]; empty: { t: string; h: string };
  customCols?: ClientField[]; locale?: FieldsLocale;
}) {
  const t = useVocab().ls;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [owner, setOwner] = useState(owners[0]?.id ?? "");
  const [maskExport, setMaskExport] = useState(true);
  const [pending, start] = useTransition();
  const assignP = usePerm("assignLeads");
  const sp = useSearchParams(), path = usePathname();
  const selectable = !masked && (perms.assign || perms.exportCsv);
  const sortHref = (k: string) => { const n = new URLSearchParams(sp.toString()); n.set("sort", k); n.delete("page"); return `${path}?${n}`; };

  const doAssign = () => start(async () => {
    const r = await assignLeads([...sel], owner);
    toastResult(r);
    if (r.ok) setSel(new Set());
  });
  const doExport = (ids: string[]) => start(async () => {
    const r = await exportLeads(ids, maskExport);
    if (r.ok && r.csv && r.filename) download(r.filename, r.csv);
    toastResult(r);
  });

  if (!rows.length) return <div className="px-4 pb-4"><Empty title={empty.t}>{empty.h}</Empty></div>;

  const columns: DataGridColumn<LeadRow>[] = [
    { id: "lead", header: t.colLead, label: t.colLead, rowHeader: true, alwaysVisible: true, className: "max-w-[176px]", cell: (r) => (
      <>
        <Link href={`/leads/${r.id}`} className="block truncate font-medium text-ink hover:text-accent">{r.name}</Link>
        <span className="block truncate text-[12px] text-ink-3">{r.title}</span>
      </>
    ) },
    { id: "firm", header: t.colFirm, label: t.colFirm, className: "max-w-[176px]", cell: (r) => (
      <>
        {r.firmId && !masked ? <Link href={`/accounts/${r.firmId}`} className="block truncate hover:text-accent">{r.firm}</Link> : <span className="block truncate">{r.firm}</span>}
        <span className="block truncate text-[12px] text-ink-3">{r.district}{r.city !== r.district ? ` · ${r.city}` : ""}</span>
      </>
    ) },
    { id: "source", header: "Source", hideOnStack: true, className: "max-w-[160px]", cell: (r) => (
      <span className="flex items-center gap-1.5" title={r.utm ? `UTM: ${r.utm}` : "No UTM tags"}>
        <ChannelMark channel={r.channel} />
        {r.campaign ? <Link href={`/campaigns/${r.campaign.id}`} className="truncate text-[12px] text-ink-2 hover:text-accent">{r.campaign.name}</Link> : <span className="truncate text-[12px] text-ink-3">{r.utm || "untagged"}</span>}
      </span>
    ) },
    { id: "stage", header: "Stage", cell: (r) => <LeadStageBadge stage={r.stage} /> },
    { id: "score", header: "Score", sortable: true, align: "right", cell: (r) => <ScoreWithFactors score={r.score} factors={r.factors} /> },
    { id: "owner", header: "Owner", cell: (r) => (r.owner ? <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2"><Avatar name={r.owner} size={20} />{r.owner.split(" ")[0]}</span> : <Badge tone="warn">Unassigned</Badge>) },
    { id: "touch", header: "Last touch", sortable: true, hideOnStack: true, className: "text-[12px] text-ink-2 num", cell: (r) => r.lastTouch },
    { id: "next", header: "Next step", hideOnStack: true, cell: (r) => <span className={cn("text-[12px] num", r.nextOverdue ? "font-medium text-danger" : "text-ink-2")}>{r.next ? `${fmtDate(r.next, locale)}, ${fmtTime(r.next, locale)}` : "—"}</span> },
    { id: "sla", header: <><span className="sr-only">SLA and consent</span><span aria-hidden>SLA · consent</span></>, label: "SLA and consent", cell: (r) => (
      <span className="flex items-center gap-1.5">
        {r.sla ? <Badge tone="danger">SLA</Badge> : <span className="w-[30px]" aria-hidden />}
        <span title={r.consent.wa ? "WhatsApp consent" : "No WhatsApp consent"} className={r.consent.wa ? "text-success" : "text-ink-3/50"}><MessageCircle className="size-3.5" aria-hidden /><span className="sr-only">{r.consent.wa ? "WhatsApp consent given" : "No WhatsApp consent"}</span></span>
        <span title={r.consent.email ? "Marketing email consent" : "No marketing email consent"} className={r.consent.email ? "text-success" : "text-ink-3/50"}><Mail className="size-3.5" aria-hidden /><span className="sr-only">{r.consent.email ? "Email consent given" : "No email consent"}</span></span>
      </span>
    ) },
    ...customCols.map((c): DataGridColumn<LeadRow> => ({ id: `custom.${c.key}`, header: pickLabel(c.label, locale), label: pickLabel(c.label, locale), hideOnStack: true, className: "max-w-[160px] text-[12px]", cell: (r) => <FieldValue def={c} value={(r.custom ?? {})[c.key]} locale={locale} /> })),
    // Phone shortcut for the stacked (small screen) layout only; on desktop the number is on the lead page.
    ...(perms.work && !masked ? [{ id: "call", header: <span className="sr-only">Call</span>, label: "Call", className: "md:hidden", cell: (r: LeadRow) => (r.phone ? <a href={`tel:${r.phone.replace(/\s/g, "")}`} className="inline-flex h-11 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink"><Phone className="size-4" aria-hidden />Call</a> : null) } satisfies DataGridColumn<LeadRow>] : []),
  ];

  return (
    <>
      {!masked && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2 sm:px-4">
          <span className="text-[12px] text-ink-3 num">{sel.size ? `${sel.size} selected` : `${allIds.length} matching`}</span>
          <div className="flex flex-wrap items-center gap-2">
            {perms.exportCsv && (
              <label className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
                <input type="checkbox" checked={maskExport} onChange={(e) => setMaskExport(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
                Mask phone and email
              </label>
            )}
            <Gate can="exportCsv">
              <Button size="sm" disabled={pending} onClick={() => doExport(sel.size ? [...sel] : allIds)}><Download />Export {sel.size ? "selected" : "CSV"}</Button>
            </Gate>
          </div>
        </div>
      )}

      <DataGrid rows={rows} columns={columns} rowId={(r) => r.id} rowLabel={(r) => r.name} caption={t.tableAria} responsive="stack" minWidth={1060 + customCols.length * 140}
        selectable={selectable} selected={sel} onSelectedChange={setSel} hideSelectionText
        sort={sort === "score" || sort === "touch" ? { id: sort, dir: "desc" } : null} sortHref={(id) => sortHref(id)} />

      {/* Bulk bar */}
      {sel.size > 0 && (
        <div role="region" aria-label="Bulk actions" className="sticky bottom-20 z-30 mx-3 mb-3 flex flex-wrap items-center gap-2 rounded-md bg-navy-900 px-3 py-2 text-navy-ink shadow-pop lg:bottom-4">
          <span className="text-[13px] font-medium num">{sel.size} selected</span>
          <button type="button" onClick={() => setSel(new Set())} className="inline-flex h-8 items-center gap-1 rounded-sm px-2 text-[12px] text-navy-ink-2 hover:text-navy-ink"><X className="size-3.5" aria-hidden />Clear</button>
          <span className="flex-1" />
          {assignP === "yes" && (
            <span className="flex items-center gap-2">
              <label className="sr-only" htmlFor="bulk-owner">Assign to</label>
              <select id="bulk-owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={cn(field, "h-8 w-auto bg-navy-800 text-navy-ink border-navy-line")}>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <Button size="sm" variant="primary" disabled={pending} onClick={doAssign}><UserRoundCheck />Assign</Button>
            </span>
          )}
          {assignP === "support" && <Gate can="assignLeads"><Button size="sm" variant="primary"><UserRoundCheck />Assign</Button></Gate>}
        </div>
      )}
    </>
  );
}
