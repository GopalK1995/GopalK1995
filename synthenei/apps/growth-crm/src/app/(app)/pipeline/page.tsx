import { pageCtx } from "@/lib/data/context";
import { pipelineTotals } from "@/lib/data/metrics";
import { can, ROLE_LABEL } from "@/lib/auth/roles";
import { dayKey, fmtDate, inr, inrCompact, num } from "@/lib/format";
import { PageHeader } from "@/components/ui/misc";
import { FilterBar } from "@/components/ui/filter-bar";
import { Board, type DealCard } from "./_components/board";
import { DAY } from "../leads/_lib/sales";
import { vocabFor } from "@/lib/vertical";

export const metadata = { title: "Pipeline" };
type SP = { owner?: string; district?: string; close?: string; value?: string };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ds, now, role, scope, masked, support, active } = await pageCtx();
  const v = vocabFor(active.tenant), pl = v.pl;
  const BANDS = pl.bands.map(([value, label, lo, hi]) => ({ value, label, test: (x: number) => x >= lo && x < hi }));
  const sp = await searchParams;
  const [allDeals, accounts, leads, team] = await Promise.all([ds.deals(), ds.accounts(), ds.leads(), ds.team()]);
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

  return (
    <>
      <PageHeader eyebrow={role === "sales_rep" ? pl.eyebrowRep : canMove ? pl.eyebrowAll : pl.eyebrowRO(v.role[role], masked)}
        title={pl.title}
        sub={pl.sub(num(t.openCount), inr(t.openValue), inrCompact(t.weighted), inrCompact(t.wonMonthValue), t.wonMonthCount)} />
      <div className="mb-4"><FilterBar filters={filters} /></div>
      <Board key={JSON.stringify(sp)} deals={cards} canMove={canMove} masked={masked} today={dayKey(now)} />
      {canMove && <p className="mt-3 hidden text-[12px] text-ink-3 md:block">{pl.hint}</p>}
    </>
  );
}
