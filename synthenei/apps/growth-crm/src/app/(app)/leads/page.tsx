import Link from "next/link";
import { pageCtx, maskName } from "@/lib/data/context";
import { CHANNEL_LABEL, LEAD_STAGES, SLA_MINUTES } from "@/lib/data/metrics";
import { can, ROLE_LABEL } from "@/lib/auth/roles";
import { dayKey, num, relTime } from "@/lib/format";
import type { Channel, Lead, LeadStage } from "@/lib/data/types";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { cn } from "@/lib/utils";
import { vocabFor } from "@/lib/vertical";
import { BAND_LABEL, VIEWS, bandOf, defaultView, isOpenLead, shortCity, type Band, type ViewKey } from "./_lib/sales";
import { LeadsTable, type LeadRow } from "./_components/leads-table";
import { ImportDialog } from "./_components/import-dialog";

export const metadata = { title: "Leads" };
const PAGE = 40;
type SP = { view?: string; q?: string; stage?: string; status?: string; source?: string; district?: string; owner?: string; band?: string; sort?: string; page?: string };

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ds, now, role, session, scope, masked, support, active, stageOrder } = await pageCtx();
  const vc = vocabFor(active.tenant), t = vc.ls;
  const sp = await searchParams;
  const [all, accounts, team, campaigns] = await Promise.all([ds.leads(), ds.accounts(), ds.team(), ds.campaigns()]);
  const visible = scope.leads(all);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const nowMs = new Date(now).getTime();
  const slaBreached = (l: Lead) => (l.firstResponseMins ?? (nowMs - new Date(l.createdAt).getTime()) / 60e3) > SLA_MINUTES && (l.firstResponseMins !== null || l.stage === "new");

  const view = (VIEWS.some((v) => v.key === sp.view) ? sp.view : defaultView(role)) as ViewKey;
  const inView = (l: Lead) =>
    view === "mine" ? l.ownerId === session.uid && isOpenLead(l)
    : view === "unassigned" ? !l.ownerId
    : view === "today" ? dayKey(l.createdAt) === dayKey(now)
    : view === "sla" ? slaBreached(l)
    : view === "hot" ? l.score >= 70 && isOpenLead(l)
    : true;
  const counts = Object.fromEntries(VIEWS.map((v) => [v.key, 0])) as Record<ViewKey, number>;
  for (const v of VIEWS) counts[v.key] = visible.filter((l) => {
    const k = v.key;
    return k === "mine" ? l.ownerId === session.uid && isOpenLead(l) : k === "unassigned" ? !l.ownerId : k === "today" ? dayKey(l.createdAt) === dayKey(now) : k === "sla" ? slaBreached(l) : k === "hot" ? l.score >= 70 && isOpenLead(l) : true;
  }).length;

  const q = (sp.q ?? "").trim().toLowerCase();
  const filtered = visible.filter(inView).filter((l) => {
    const a = acc.get(l.accountId);
    if (sp.stage && l.stage !== sp.stage) return false;
    if (sp.status && l.status !== sp.status) return false;
    if (sp.source && l.channel !== sp.source) return false;
    if (sp.district && a?.district !== sp.district) return false;
    if (sp.owner && l.ownerId !== sp.owner) return false;
    if (sp.band && bandOf(l.score) !== sp.band) return false;
    if (q) {
      const hay = (masked ? `${a?.name} ${l.city} ${a?.district}` : `${l.name} ${a?.name} ${l.city} ${a?.district} ${l.email}`).toLowerCase();
      const digits = q.replace(/\D/g, "");
      const phoneHit = !masked && digits.length >= 3 && l.phone.replace(/\D/g, "").includes(digits);
      if (!hay.includes(q) && !phoneHit) return false;
    }
    return true;
  });
  const sort = sp.sort === "score" || sp.sort === "touch" ? sp.sort : view === "hot" ? "score" : "created";
  filtered.sort((a, b) => sort === "score" ? b.score - a.score : sort === "touch" ? a.lastTouchAt.localeCompare(b.lastTouchAt) : b.createdAt.localeCompare(a.createdAt));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const slice = filtered.slice((page - 1) * PAGE, page * PAGE);

  const owners = team.filter((t) => t.role === "sales_rep" || t.role === "sales_manager");
  const rows: LeadRow[] = slice.map((l) => {
    const a = acc.get(l.accountId);
    const cmp = campaigns.find((c) => c.id === l.campaignId);
    const ownerName = team.find((t) => t.id === l.ownerId)?.name ?? null;
    return {
      id: l.id, name: masked ? maskName(l.name) : l.name, title: l.title, firm: a?.name ?? t.unknownFirm, firmId: a?.id ?? null,
      district: a?.district ?? "Unknown", city: shortCity(l.city), channel: l.channel, campaign: cmp ? { id: cmp.id, name: cmp.name } : null,
      utm: [l.utm.source, l.utm.medium, l.utm.campaign].filter(Boolean).join(" / "),
      stage: l.stage, score: l.score, factors: [...l.scoreFactors].sort((x, y) => Math.abs(y.points) - Math.abs(x.points)),
      owner: ownerName, ownerId: l.ownerId || null,
      lastTouch: `${relTime(l.lastTouchAt, now)}, ${CHANNEL_LABEL[l.lastTouch]}`,
      next: l.nextActionAt, nextOverdue: !!l.nextActionAt && l.nextActionAt < now,
      sla: slaBreached(l),
      consent: { wa: l.consent.whatsapp, email: l.consent.marketing },
      phone: masked ? null : l.phone,
    };
  });

  const districts = [...new Set(visible.map((l) => acc.get(l.accountId)?.district).filter(Boolean) as string[])].sort();
  const channels = [...new Set(visible.map((l) => l.channel))] as Channel[];
  const filters = [
    { key: "stage", label: "Stage", options: stageOrder.lead.map((s: LeadStage) => ({ value: s, label: vc.leadStage[s] })) },
    { key: "status", label: "Status", options: (["new", "contacted", "qualified", "nurturing", "disqualified", "converted"] as const).map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })) },
    { key: "source", label: "Source", options: channels.map((c) => ({ value: c, label: CHANNEL_LABEL[c] })) },
    { key: "district", label: t.district, options: districts.map((d) => ({ value: d, label: d })) },
    ...(role === "sales_rep" ? [] : [{ key: "owner", label: "Owner", options: owners.map((o) => ({ value: o.id, label: o.name })) }]),
    { key: "band", label: "Score", options: (["hot", "warm", "cool"] as Band[]).map((b) => ({ value: b, label: BAND_LABEL[b] })) },
  ];
  const viewHref = (k: ViewKey) => {
    const n = new URLSearchParams(Object.entries(sp).filter(([key, v]) => v && key !== "page" && key !== "view") as [string, string][]);
    n.set("view", k);
    return `/leads?${n}`;
  };
  const pageHref = (p: number) => {
    const n = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
    n.set("page", String(p)); n.set("view", view);
    return `/leads?${n}`;
  };
  const perms = {
    assign: can("assignLeads", { role, support }), exportCsv: can("exportCsv", { role, support }),
    importCsv: can("importCsv", { role, support }), work: can("workLeads", { role, support }),
  };
  const viewLabel = vc.views[view];
  const emptyMsg =
    view === "mine" ? { t: t.emptyMine, h: t.emptyMineHint(counts.unassigned) }
    : view === "unassigned" ? { t: t.emptyUnassigned, h: t.emptyUnassignedHint }
    : view === "today" ? { t: t.emptyToday, h: t.emptyTodayHint }
    : view === "sla" ? { t: t.emptySla, h: t.emptySlaHint }
    : { t: t.emptyFilter, h: t.emptyFilterHint };

  return (
    <>
      <PageHeader eyebrow={role === "sales_rep" ? t.eyebrowRep : masked ? t.eyebrowMasked(vc.role[role]) : t.eyebrowAll(num(visible.length))}
        title={t.title}
        sub={t.sub(viewLabel, num(filtered.length), filtered.length, filtered.length > PAGE ? `, showing ${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, filtered.length)}` : "")}
        actions={<ImportDialog />} />

      <nav aria-label="Saved views" className="scrollbar-thin -mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {VIEWS.filter((v) => !(v.key === "mine" && role !== "sales_rep" && role !== "sales_manager")).map((v) => (
          <Link key={v.key} href={viewHref(v.key)} aria-current={v.key === view ? "page" : undefined}
            className={cn("relative inline-flex h-10 shrink-0 items-center gap-1.5 px-3 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", v.key === view ? "text-ink after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent" : "text-ink-3 hover:text-ink")}>
            {vc.views[v.key]}<span className={cn("num text-[11px]", v.key === "sla" && counts.sla ? "text-danger" : "text-ink-3")}>{counts[v.key]}</span>
          </Link>
        ))}
      </nav>

      <Card>
        <div className="flex flex-col gap-3 p-3 sm:p-4">
          <FilterBar search={masked ? t.searchMasked : t.search} filters={filters} />
        </div>
        <LeadsTable rows={rows} owners={owners.map((o) => ({ id: o.id, name: o.name }))} perms={perms} masked={masked} sort={sort}
          allIds={filtered.map((l) => l.id)} empty={emptyMsg} />
        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-2 border-t border-line px-4 py-3 text-[12px] text-ink-3">
            <span className="num">Page {page} of {pages}</span>
            <span className="flex gap-1">
              {page > 1 && <Link className="inline-flex h-8 items-center rounded-sm border border-line-strong bg-surface px-3 text-ink hover:bg-paper-2" href={pageHref(page - 1)}>Previous</Link>}
              {page < pages && <Link className="inline-flex h-8 items-center rounded-sm border border-line-strong bg-surface px-3 text-ink hover:bg-paper-2" href={pageHref(page + 1)}>Next</Link>}
            </span>
          </nav>
        )}
      </Card>
      {masked && <p className="mt-3 text-[12px] text-ink-3"><Badge tone="outline">Masked</Badge> {t.maskedNote}</p>}
    </>
  );
}
