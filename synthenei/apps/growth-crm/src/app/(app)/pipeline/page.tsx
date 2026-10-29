import { pageCtx } from "@/lib/data/context";
import { pipelineTotals } from "@/lib/data/metrics";
import { can, ROLE_LABEL } from "@/lib/auth/roles";
import { dayKey, fmtDate, inr, inrCompact, num } from "@/lib/format";
import { PageHeader } from "@/components/ui/misc";
import { FilterBar } from "@/components/ui/filter-bar";
import { Board, type DealCard } from "./_components/board";
import { DAY } from "../leads/_lib/sales";
import { vocabFor } from "@/lib/vertical";
import { PartialState } from "@/components/ui/states";
import { getLocale } from "@/i18n/server";
import { fill, pipelineLabels } from "./_lib/labels";
import { DEFAULT_STAGE_MAX_DAYS } from "./_lib/stage-age";

export const metadata = { title: "Pipeline" };
type SP = { owner?: string; district?: string; close?: string; value?: string };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ds, now, role, scope, masked, support, active } = await pageCtx();
  const v = vocabFor(active.tenant), pl = v.pl;
  const BANDS = pl.bands.map(([value, label, lo, hi]) => ({ value, label, test: (x: number) => x >= lo && x < hi }));
  const sp = await searchParams;
  const labels = pipelineLabels(await getLocale(), { deal: v.n.deal.one, deals: v.n.deal.many });
  // Deals are the page: a failure there goes to error.tsx. Names are secondary: a failed source degrades to a partial state.
  const [dealsR, accountsR, leadsR, teamR] = await Promise.allSettled([ds.deals(), ds.accounts(), ds.leads(), ds.team()]);
  if (dealsR.status === "rejected") throw dealsR.reason;
  const allDeals = dealsR.value, accounts = accountsR.status === "fulfilled" ? accountsR.value : [], leads = leadsR.status === "fulfilled" ? leadsR.value : [], team = teamR.status === "fulfilled" ? teamR.value : [];
  const sources = [
    { label: labels.partialDeals, status: "ok" as const },
    { label: labels.partialAccounts, status: accountsR.status === "fulfilled" ? ("ok" as const) : ("failed" as const) },
    { label: labels.partialOwners, status: teamR.status === "fulfilled" ? ("ok" as const) : ("failed" as const) },
  ];
  const failed = sources.filter((x) => x.status === "failed").length;
  const deals = scope.deals(allDeals);
  const nowMs = new Date(now).getTime();
  const acc = new Map(accounts.map((a) => [a.id, a]));

  const filtered = deals.filter((d) => {
    if (sp.owner && d.ownerId !== sp.owner) return false;
    if (sp.district && acc.get(d.accountId)?.district !== sp.district) return false;
    if (sp.close && (d.wonAt ?? d.expectedClose).slice(0, 7) !== sp.close) return false;
    const band = BANDS.find((b) => b.value === sp.value);
    if (band && !band.test(d.value)) return false;
    return true;
  });
  const cards: DealCard[] = filtered.map((d) => {
    const l = leads.find((x) => x.id === d.leadId);
    return {
      id: d.id, name: d.name, firm: acc.get(d.accountId)?.name ?? d.name, contact: masked || !l ? null : `${l.name}, ${l.title}`, leadId: d.leadId,
      value: d.value, seats: d.seats, plan: d.plan, stayLine: d.stay ? `${d.seats} ${d.seats === 1 ? "night" : "nights"} · ${d.stay.rooms} ${d.stay.rooms === 1 ? "room" : "rooms"} · in ${fmtDate(d.stay.checkIn + "T06:00:00Z")}` : undefined, owner: team.find((t) => t.id === d.ownerId)?.name ?? "Unassigned",
      version: (d as { version?: number }).version, slaDays: DEFAULT_STAGE_MAX_DAYS,
      days: Math.max(0, Math.floor((nowMs - new Date(d.stageEnteredAt).getTime()) / DAY)),
      next: l?.nextActionAt ?? null, nextOverdue: !!l?.nextActionAt && l.nextActionAt < now,
      stage: d.stage, close: d.wonAt ?? d.expectedClose, prob: d.probability, lostReason: d.lostReason,
    };
  }).sort((a, b) => b.value - a.value);

  const t = pipelineTotals(filtered, now);
  const months = [...new Set(deals.map((d) => (d.wonAt ?? d.expectedClose).slice(0, 7)))].sort();
  const monthLabel = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  const districts = [...new Set(deals.map((d) => acc.get(d.accountId)?.district).filter(Boolean) as string[])].sort();
  const owners = team.filter((m) => deals.some((d) => d.ownerId === m.id));
  const filters = [
    ...(role === "sales_rep" ? [] : [{ key: "owner", label: "Owner", options: owners.map((o) => ({ value: o.id, label: o.name })) }]),
    { key: "district", label: pl.district, options: districts.map((d) => ({ value: d, label: d })) },
    { key: "close", label: pl.close, options: months.map((m) => ({ value: m, label: monthLabel(m) })) },
    { key: "value", label: "Value", options: BANDS.map(({ value, label }) => ({ value, label })) },
  ];
  const canMove = can("moveDeals", { role, support });
  const moveReason = canMove ? null : support ? labels.deniedSupport : fill(labels.deniedPage);

  return (
    <>
      <PageHeader eyebrow={role === "sales_rep" ? pl.eyebrowRep : canMove ? pl.eyebrowAll : pl.eyebrowRO(v.role[role], masked)}
        title={pl.title}
        sub={pl.sub(num(t.openCount), inr(t.openValue), inrCompact(t.weighted), inrCompact(t.wonMonthValue), t.wonMonthCount)} />
      <div className="mb-4"><FilterBar filters={filters} /></div>
      {failed > 0 && <PartialState className="mb-4" done={sources.length - failed} total={sources.length} items={sources} noun={labels.partialNoun} />}
      {!canMove && <p role="note" className="mb-3 text-[13px] text-ink-2" data-testid="pipeline-readonly">{moveReason}</p>}
      <Board key={JSON.stringify(sp)} deals={cards} canMove={canMove} canMoveReason={moveReason} masked={masked} today={dayKey(now)} labels={labels} />
      {canMove && <p className="mt-3 hidden text-[12px] text-ink-3 md:block">{pl.hint}</p>}
    </>
  );
}
