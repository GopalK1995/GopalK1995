"use client";
// Dense lead table with selection + bulk bar (desktop) and stacked cards below 768px.
// Personal data never reaches this component for masked roles: the server page strips it first.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, Download, Mail, MessageCircle, Phone, UserRoundCheck, X } from "lucide-react";
import type { Channel, LeadStage, ScoreFactor } from "@/lib/data/types";
import { fmtDate, fmtTime } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Gate } from "@/components/ui/gate";
import { usePerm } from "./perm";
import { Tip } from "@/components/ui/tooltip";
import { ScoreChip, Empty, th, thNum, td, tdNum } from "@/components/ui/misc";
import { ChannelMark, LeadStageBadge } from "@/components/ui/domain";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { assignLeads, exportLeads } from "../actions";
import { field } from "../_lib/sales";

export type LeadRow = {
  id: string; name: string; title: string; firm: string; firmId: string | null; district: string; city: string;
  channel: Channel; campaign: { id: string; name: string } | null; utm: string; stage: LeadStage; score: number; factors: ScoreFactor[];
  owner: string | null; ownerId: string | null; lastTouch: string; next: string | null; nextOverdue: boolean; sla: boolean;
  consent: { wa: boolean; email: boolean }; phone: string | null;
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

export function LeadsTable({ rows, owners, perms, masked, sort, allIds, empty }: {
  rows: LeadRow[]; owners: { id: string; name: string }[]; perms: Perms; masked: boolean; sort: string; allIds: string[]; empty: { t: string; h: string };
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [owner, setOwner] = useState(owners[0]?.id ?? "");
  const [maskExport, setMaskExport] = useState(true);
  const [pending, start] = useTransition();
  const assignP = usePerm("assignLeads");
  const sp = useSearchParams(), path = usePathname();
  const selectable = !masked && (perms.assign || perms.exportCsv);
  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => sel.has(id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const sortHref = (k: string) => { const n = new URLSearchParams(sp.toString()); n.set("sort", k); n.delete("page"); return `${path}?${n}`; };

  const doAssign = () => start(async () => {
    const r = await assignLeads([...sel], owner);
    toast(r.message, r.sub);
    if (r.ok) setSel(new Set());
  });
  const doExport = (ids: string[]) => start(async () => {
    const r = await exportLeads(ids, maskExport);
    if (r.ok && r.csv && r.filename) download(r.filename, r.csv);
    toast(r.message, r.sub);
  });

  if (!rows.length) return <div className="px-4 pb-4"><Empty title={empty.t}>{empty.h}</Empty></div>;

  const SortTh = ({ k, children, right }: { k: string; children: React.ReactNode; right?: boolean }) => (
    <th scope="col" className={right ? thNum : th} aria-sort={sort === k ? "descending" : "none"}>
      <Link href={sortHref(k)} scroll={false} className={cn("inline-flex items-center gap-1 hover:text-ink", sort === k && "text-ink")}>{children}{sort === k && <ArrowDown className="size-3" aria-hidden />}</Link>
    </th>
  );

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

      {/* Desktop and tablet */}
      <div className="scrollbar-thin relative hidden overflow-x-auto md:block">
        <table className="w-full border-collapse" style={{ minWidth: 1060 }} aria-label="Leads" aria-rowcount={allIds.length}>
          <thead>
            <tr className="border-y border-line bg-paper/60">
              {selectable && (
                <th scope="col" className="w-10 px-3">
                  <input type="checkbox" aria-label="Select all leads on this page" checked={allOnPage}
                    onChange={() => setSel((s) => { const n = new Set(s); pageIds.forEach((id) => (allOnPage ? n.delete(id) : n.add(id))); return n; })} className="size-4 accent-[var(--accent)]" />
                </th>
              )}
              <th scope="col" className={th}>Lead</th>
              <th scope="col" className={th}>Firm · district</th>
              <th scope="col" className={th}>Source</th>
              <th scope="col" className={th}>Stage</th>
              <SortTh k="score" right>Score</SortTh>
              <th scope="col" className={th}>Owner</th>
              <SortTh k="touch">Last touch</SortTh>
              <th scope="col" className={th}>Next step</th>
              <th scope="col" className={th}><span className="sr-only">SLA and consent</span><span aria-hidden>SLA · consent</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={cn("border-b border-line last:border-0 hover:bg-paper/60", sel.has(r.id) && "bg-accent-soft/40")}>
                {selectable && <td className="w-10 px-3"><input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} className="size-4 accent-[var(--accent)]" /></td>}
                <td className={cn(td, "max-w-[176px]")}>
                  <Link href={`/leads/${r.id}`} className="block truncate font-medium text-ink hover:text-accent">{r.name}</Link>
                  <span className="block truncate text-[12px] text-ink-3">{r.title}</span>
                </td>
                <td className={cn(td, "max-w-[176px]")}>
                  {r.firmId && !masked ? <Link href={`/accounts/${r.firmId}`} className="block truncate hover:text-accent">{r.firm}</Link> : <span className="block truncate">{r.firm}</span>}
                  <span className="block truncate text-[12px] text-ink-3">{r.district}{r.city !== r.district ? ` · ${r.city}` : ""}</span>
                </td>
                <td className={cn(td, "max-w-[160px]")}>
                  <span className="flex items-center gap-1.5" title={r.utm ? `UTM: ${r.utm}` : "No UTM tags"}>
                    <ChannelMark channel={r.channel} />
                    {r.campaign ? <Link href={`/campaigns/${r.campaign.id}`} className="truncate text-[12px] text-ink-2 hover:text-accent">{r.campaign.name}</Link> : <span className="truncate text-[12px] text-ink-3">{r.utm || "untagged"}</span>}
                  </span>
                </td>
                <td className={td}><LeadStageBadge stage={r.stage} /></td>
                <td className={tdNum}><ScoreWithFactors score={r.score} factors={r.factors} /></td>
                <td className={td}>{r.owner ? <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2"><Avatar name={r.owner} size={20} />{r.owner.split(" ")[0]}</span> : <Badge tone="warn">Unassigned</Badge>}</td>
                <td className={cn(td, "text-[12px] text-ink-2 num")}>{r.lastTouch}</td>
                <td className={cn(td, "text-[12px] num", r.nextOverdue ? "font-medium text-danger" : "text-ink-2")}>{r.next ? `${fmtDate(r.next)}, ${fmtTime(r.next)}` : "—"}</td>
                <td className={td}>
                  <span className="flex items-center gap-1.5">
                    {r.sla ? <Badge tone="danger">SLA</Badge> : <span className="w-[30px]" aria-hidden />}
                    <span title={r.consent.wa ? "WhatsApp consent" : "No WhatsApp consent"} className={r.consent.wa ? "text-success" : "text-ink-3/50"}><MessageCircle className="size-3.5" aria-hidden /><span className="sr-only">{r.consent.wa ? "WhatsApp consent given" : "No WhatsApp consent"}</span></span>
                    <span title={r.consent.email ? "Marketing email consent" : "No marketing email consent"} className={r.consent.email ? "text-success" : "text-ink-3/50"}><Mail className="size-3.5" aria-hidden /><span className="sr-only">{r.consent.email ? "Email consent given" : "No email consent"}</span></span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: title, two facts, one primary action */}
      <ul className="divide-y divide-line border-t border-line md:hidden" aria-label="Leads">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/leads/${r.id}`} className="block truncate text-[14px] font-medium text-ink">{r.name}</Link>
              <div className="mt-0.5 truncate text-[12px] text-ink-3">{r.firm} · {r.district}</div>
              <div className="mt-1 flex items-center gap-2"><ScoreChip score={r.score} /><LeadStageBadge stage={r.stage} />{r.sla && <Badge tone="danger">SLA</Badge>}</div>
            </div>
            {perms.work && r.phone && !masked
              ? <a href={`tel:${r.phone.replace(/\s/g, "")}`} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-sm border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink"><Phone className="size-4" aria-hidden />Call</a>
              : <Link href={`/leads/${r.id}`} className="inline-flex h-11 shrink-0 items-center rounded-sm border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink">Open</Link>}
          </li>
        ))}
      </ul>

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
