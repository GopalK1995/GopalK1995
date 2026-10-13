import { pageCtx } from "@/lib/data/context";
import { pipelineTotals } from "@/lib/data/metrics";
import { can, ROLE_LABEL } from "@/lib/auth/roles";
import { dayKey, inr, inrCompact, num } from "@/lib/format";
import { PageHeader } from "@/components/ui/misc";
import { FilterBar } from "@/components/ui/filter-bar";
import { Board, type DealCard } from "./_components/board";
import { DAY } from "../leads/_lib/sales";

export const metadata = { title: "Pipeline" };
type SP = { owner?: string; district?: string; close?: string; value?: string };
const BANDS = [
  { value: "lt1", label: "Under ₹1 L", test: (v: number) => v < 1e5 },
  { value: "1to3", label: "₹1 L – ₹3 L", test: (v: number) => v >= 1e5 && v < 3e5 },
  { value: "gt3", label: "₹3 L and above", test: (v: number) => v >= 3e5 },
];

export default async function PipelinePage({ searchParams }: { searchParams: Promise<SP> }) {
  const { ds, now, role, scope, masked, support } = await pageCtx();
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
      value: d.value, seats: d.seats, plan: d.plan, owner: team.find((t) => t.id === d.ownerId)?.name ?? "Unassigned",
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
    { key: "district", label: "District", options: districts.map((d) => ({ value: d, label: d })) },
    { key: "close", label: "Close month", options: months.map((m) => ({ value: m, label: monthLabel(m) })) },
    { key: "value", label: "Value", options: BANDS.map(({ value, label }) => ({ value, label })) },
  ];
  const canMove = can("moveDeals", { role, support });

  return (
    <>
      <PageHeader eyebrow={role === "sales_rep" ? "Your deals" : canMove ? "All reps" : `Read-only for ${ROLE_LABEL[role]}${masked ? ": firm names only" : ""}`}
        title="Pipeline"
        sub={`${num(t.openCount)} open deals worth ${inr(t.openValue)}, weighted ${inrCompact(t.weighted)} by stage probability. Won this month: ${inrCompact(t.wonMonthValue)} from ${t.wonMonthCount} deal${t.wonMonthCount === 1 ? "" : "s"}.`} />
      <div className="mb-4"><FilterBar filters={filters} /></div>
      <Board key={JSON.stringify(sp)} deals={cards} canMove={canMove} masked={masked} today={dayKey(now)} />
      {canMove && <p className="mt-3 hidden text-[12px] text-ink-3 md:block">Drag a card to another column, or use its move button (keyboard: Tab to the button, Enter, arrow keys). Cards turn amber after 10 days in a stage and red after 14.</p>}
    </>
  );
}
