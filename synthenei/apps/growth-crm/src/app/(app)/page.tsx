import Link from "next/link";
import { ArrowRight, Clock, DatabaseBackup, FileClock, UserX } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import {
  SLA_MINUTES, DEAL_STAGES, campaignStats, channelMix, funnel, isDemo, leaderboard, DEMOS_DONE_TARGET, leadsPerDay, pipelineTotals, slaStats, topFirms,
} from "@/lib/data/metrics";
import { fmtWeekday, fmtDate, inr, inrCompact, num, pct, ratio, minsToHuman } from "@/lib/format";
import { Card, CardBody, CardHeader, NavyPanel } from "@/components/ui/card";
import { Kpi } from "@/components/ui/kpi";
import { PageHeader, Meter } from "@/components/ui/misc";
import { DataTable } from "@/components/ui/data-table";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { DealStageBadge } from "@/components/ui/domain";
import { Avatar } from "@/components/ui/avatar";
import { LineTrend } from "@/components/charts/line-trend";
import { Donut } from "@/components/charts/donut";
import { HBar } from "@/components/charts/hbar";
import { Funnel } from "@/components/charts/funnel";
import { TargetBar } from "@/components/charts/target";
import { cn } from "@/lib/utils";
import { vocabFor } from "@/lib/vertical";
import { Columns } from "@/components/charts/columns";

export const metadata = { title: "Command Center" };
const DAY = 86400e3;

export default async function CommandCenter() {
  const { ds, now, masked, active, stageOrder } = await pageCtx();
  const v = vocabFor(active.tenant), c = v.cc, hosp = v.id === "hospitality";
  const [leads, deals, campaigns, days, { days: ga4 }, team, accounts, _syncRuns, acts] = await Promise.all([
    ds.leads(), ds.deals(), ds.campaigns(), ds.campaignDays(), ds.ga4(), ds.team(), ds.accounts(), ds.syncRuns(), ds.activities(),
  ]);
  const nowMs = new Date(now).getTime();
  const tot = pipelineTotals(deals, now);
  const teamTarget = team.filter((t) => t.role === "sales_rep").reduce((a, t) => a + t.monthlyTarget, 0);
  const d = new Date(now), dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const pace = d.getUTCDate() / dim;

  const inWin = (from: number, to: number) => leads.filter((l) => { const t = nowMs - new Date(l.createdAt).getTime(); return t >= from * DAY && t < to * DAY; });
  const l30 = inWin(0, 30), lPrev = inWin(30, 60);
  // Hospitality: "converted" = booked (stage won); legal: demo reached.
  const conv = (l: (typeof leads)[number]) => (hosp ? l.stage === "won" : isDemo(l));
  const demos30 = l30.filter(conv).length, demosPrev = lPrev.filter(conv).length;
  const stats = campaigns.map((c) => campaignStats(c, days, leads, deals));
  const spend30 = days.filter((x) => nowMs - new Date(x.date + "T12:00:00+05:30").getTime() < 30 * DAY).reduce((a, x) => a + x.spend, 0);
  const spendPrev = days.filter((x) => { const t = nowMs - new Date(x.date + "T12:00:00+05:30").getTime(); return t >= 30 * DAY && t < 60 * DAY; }).reduce((a, x) => a + x.spend, 0);
  // Cost per demo by the date the demo was booked (not lead cohort), so recent leads don't look artificially expensive.
  const paidIds = new Set(leads.filter((l) => l.campaignId).map((l) => l.id));
  const wonIn = (from: number, to: number) => deals.filter((x) => x.stage === "won" && x.wonAt && paidIds.has(x.leadId) && nowMs - new Date(x.wonAt).getTime() >= from * DAY && nowMs - new Date(x.wonAt).getTime() < to * DAY).length;
  const booked = (from: number, to: number) => hosp ? wonIn(from, to) : acts.filter((a) => a.kind === "demo_booked" && paidIds.has(a.leadId) && nowMs - new Date(a.at).getTime() >= from * DAY && nowMs - new Date(a.at).getTime() < to * DAY).length;
  const cpd = ratio(spend30, booked(0, 30));
  const cpdPrev = ratio(spendPrev, booked(30, 60));
  const sla = slaStats(l30, now), slaPrev = slaStats(lPrev, now);

  const perDay = leadsPerDay(leads, ga4, 90);
  const trend = perDay.map((p, i) => ({ date: p.date, leads: p.leads, avg: Math.round((perDay.slice(Math.max(0, i - 6), i + 1).reduce((a, x) => a + x.leads, 0) / Math.min(7, i + 1)) * 10) / 10 }));
  const weeklySpark = (fn: (i: number) => number) => Array.from({ length: 8 }, (_, i) => fn(7 - i));
  const leadsWeekly = weeklySpark((w) => inWin(w * 7, w * 7 + 7).length);

  const mix = channelMix(leads, 4, v.channelFamily);
  const cpdRows = stats.filter((s) => (hosp ? s.won : s.demos) > 0 && s.spend > 0).map((s) => ({ label: s.name.split(" — ")[0], value: Math.round(hosp ? s.spend / s.won : s.costPerDemo), note: c.cpdNote(hosp ? s.won : s.demos, inrCompact(s.spend)) })).sort((a, b) => a.value - b.value);
  const steps = funnel(leads, ga4, 90, v.funnel);
  const firms = topFirms(accounts, deals, leads, 6);
  const board = leaderboard(team, deals, leads, acts, now);
  const open = deals.filter((x) => x.stage !== "won" && x.stage !== "lost");
  const byStage = stageOrder.deal.filter((s) => s !== "won" && s !== "lost").map((s, i) => ({ s, v: open.filter((x) => x.stage === s).reduce((a, x) => a + x.value, 0), c: [`var(--seq-1)`, `var(--seq-2)`, `var(--seq-3)`, `var(--accent-on-navy)`, `var(--chart-5)`][i] }));

  const closing = [...open].filter((x) => x.stage === "proposal" || x.stage === "negotiation").sort((a, b) => a.expectedClose.localeCompare(b.expectedClose)).slice(0, 3);
  const unanswered = leads.filter((l) => l.firstResponseMins === null && nowMs - new Date(l.createdAt).getTime() > SLA_MINUTES * 60e3);
  const staleProposals = deals.filter((x) => (x.stage === "proposal" || x.stage === "negotiation") && nowMs - new Date(x.stageEnteredAt).getTime() > 7 * DAY);
  const quietBy = new Map<string, number>();
  accounts.filter((a) => a.status === "prospect" && nowMs - new Date(a.lastActivityAt).getTime() > 5 * DAY).forEach((a) => quietBy.set(a.city, (quietBy.get(a.city) ?? 0) + 1));
  const [quietCity, quietN] = [...quietBy.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const monthName = (d_: Date) => d_.toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
  const curMonth = monthName(new Date(now)), prevMonthName = monthName(new Date(new Date(now).setUTCMonth(new Date(now).getUTCMonth() - 1)));
  // Hospitality extras: enquiries vs bookings by month (last 6 months) and 30-day forward occupancy from booked stays.
  const monthKey = (iso: string) => iso.slice(0, 7);
  const months = Array.from({ length: 6 }, (_, i) => { const x = new Date(new Date(now).setUTCDate(1)); x.setUTCMonth(x.getUTCMonth() - (5 - i)); return x.toISOString().slice(0, 7); });
  const monthly = months.map((m) => ({ month: new Date(m + "-01T12:00:00Z").toLocaleString("en-IN", { month: "short", timeZone: "UTC" }), enquiries: leads.filter((l) => monthKey(l.createdAt) === m).length, bookings: deals.filter((x) => x.stage === "won" && x.wonAt && monthKey(x.wonAt) === m).length }));
  const ROOMS = v.rooms;
  const today0 = new Date(now.slice(0, 10) + "T00:00:00Z").getTime();
  const occ = Array.from({ length: 30 }, (_, i) => {
    const t = today0 + i * DAY;
    const used = deals.filter((x) => x.stage === "won" && x.stay && x.stay.status !== "cancelled" && new Date(x.stay.checkIn + "T00:00:00Z").getTime() <= t && t < new Date(x.stay.checkIn + "T00:00:00Z").getTime() + x.stay.nights * DAY).reduce((a, x) => a + (x.stay?.rooms ?? 1), 0);
    return { day: String(new Date(t).getUTCDate()), occupancy: Math.min(1, used / ROOMS) };
  });
  const occAvg = Math.round((occ.reduce((a, o) => a + o.occupancy, 0) / occ.length) * 100);
  const districtCount = new Set(accounts.map((a) => a.district)).size;
  /** Delta only when the base is big enough to mean something. */
  const delta = (cur: number, prev: number, minBase = 5) => (prev >= minBase ? ratio(cur - prev, prev) : undefined);

  return (
    <>
      <PageHeader eyebrow={`${fmtWeekday(now)}, ${fmtDate(now)} · IST`} title="Command Center"
        sub={c.sub(districtCount, active.ws.region.replace(/ · /g, ", "))} />

      {/* alerts strip: specific, actionable, never generic */}
      <Stagger className="mb-6 flex flex-wrap gap-2">
        {[
          unanswered.length ? { icon: UserX, tone: "danger", text: c.unanswered(unanswered.length), href: "/leads?view=sla" } : { icon: UserX, tone: "ok", text: c.unansweredOk, href: "/leads?view=sla" },
          { icon: Clock, tone: "warn", text: quietN ? c.quiet(quietN, quietCity === "Tiruchirappalli" ? "Trichy" : quietCity) : c.quietOk, href: quietN ? `/accounts?city=${quietCity}` : "/accounts" },
          { icon: FileClock, tone: "warn", text: c.stale(staleProposals.length), href: "/pipeline" },
          { icon: DatabaseBackup, tone: "ok", text: "Backup check (sample): last 6 h ago, threshold 26 h", href: "/data-health" },
        ].map((a) => (
          <StaggerItem key={a.text}>
            <Link href={a.href} className="group inline-flex h-8 items-center gap-2 rounded-sm border border-line bg-surface px-3 text-[12px] text-ink-2 shadow-1 hover:border-line-strong hover:text-ink">
              <a.icon className={cn("size-3.5", a.tone === "danger" ? "text-danger" : a.tone === "warn" ? "text-warn" : "text-success")} aria-hidden />
              <span className="num">{a.text}</span>
              <ArrowRight className="size-3 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </StaggerItem>
        ))}
      </Stagger>

      <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* KEY PANEL (navy, 30% structure): the number leadership opens the app for */}
        <StaggerItem className="lg:col-span-5">
          <NavyPanel className="flex h-full flex-col gap-5 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[12px] font-medium text-navy-ink-2">{c.headline}</div>
                <div className="mt-1 text-[34px] font-semibold leading-10 tracking-[-0.025em] num">{inr(tot.openValue)}</div>
                <div className="mt-1 text-[12px] text-navy-ink-3 num">{c.headlineFoot(tot.openCount, inrCompact(tot.weighted), pct(tot.winRate, 0))}</div>
              </div>
            </div>
            <div>
              <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-[3px]" role="img" aria-label={c.stageAria}>
                {byStage.filter((b) => b.v > 0).map((b) => <div key={b.s} style={{ flexGrow: b.v, background: b.c }} title={`${v.dealStage[b.s]}: ${inr(b.v)}`} />)}
              </div>
              <ul className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                {byStage.map((b) => (
                  <li key={b.s} className="flex items-center justify-between gap-2 text-navy-ink-2">
                    <span className="flex items-center gap-1.5 truncate"><span className="size-2 shrink-0 rounded-[2px]" style={{ background: b.c }} />{v.dealStage[b.s]}</span>
                    <span className="num text-navy-ink">{inrCompact(b.v)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-navy-ink-3">{c.closing}</div>
              <ul className="divide-y divide-navy-line/70 text-[12px]">
                {closing.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate text-navy-ink-2"><span className="text-navy-ink">{accounts.find((a) => a.id === c.accountId)?.name}</span> · {v.dealStage[c.stage]}</span>
                    <span className="shrink-0 num text-navy-ink-2">{fmtDate(c.expectedClose)} · <span className="font-medium text-navy-ink">{inrCompact(c.value)}</span></span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-auto border-t border-navy-line pt-4">
              <TargetBar tone="navy" value={tot.wonMonthValue} target={teamTarget} pace={pace} label={c.wonIn(curMonth, tot.wonMonthCount)} format="inrCompact" />
            </div>
          </NavyPanel>
        </StaggerItem>

        <StaggerItem className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
          <Kpi label={c.kWon} metric="M42" value={tot.wonMonthValue} format="inr" delta={tot.wonPrevValue > 0 ? ratio(tot.wonMonthValue - tot.wonPrevValue, tot.wonPrevValue) : undefined} deltaLabel={c.prevMonthLabel(prevMonthName)}
            foot={Number.isFinite(tot.avgDeal) ? <>{c.kWonFoot(inrCompact(tot.avgDeal))}</> : <>{c.kWonNone}</>} />
          <Kpi label={c.kNew} metric="M5" value={l30.length} delta={delta(l30.length, lPrev.length)} spark={leadsWeekly}
            foot={<>{num(lPrev.length)} in the previous 30 days</>} />
          <Kpi label={c.kConv} metric="M12" value={ratio(demos30, l30.length)} format="pct" delta={lPrev.length >= 10 ? ratio(demos30, l30.length) - ratio(demosPrev, lPrev.length) : undefined} deltaLabel="pts vs prev."
            foot={<>{c.kConvFoot(demos30, l30.length)}</>} />
          <Kpi label={c.kCost} metric="M11" value={cpd} format="inr" delta={booked(30, 60) >= 5 ? ratio(cpd - cpdPrev, cpdPrev) : undefined} goodWhen="down"
            foot={<>{c.kCostFoot(booked(0, 30), inrCompact(spend30), pct(sla.within, 0), minsToHuman(sla.median), pct(slaPrev.within, 0))}</>} />
        </StaggerItem>

        <StaggerItem className="lg:col-span-8">
          <Card className="h-full">
            <CardHeader title={c.perDay} sub={c.perDaySub} />
            <CardBody>
              <LineTrend label={c.perDayAria} height={248} yFormat="num"
                data={trend} series={[{ key: "leads", label: c.perDayBar, color: "var(--seq-1)", bar: true }, { key: "avg", label: "7-day average", color: "var(--chart-1)", area: true }]} />
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title={c.mix} sub={c.mixSub} />
            <CardBody><Donut label={c.mixAria} data={mix} centerValue={num(leads.length)} centerLabel={c.mixCenter} /></CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-6">
          <Card className="h-full">
            <CardHeader title={c.funnel} sub="Cohort of the last 90 days" />
            <CardBody><Funnel steps={steps} /></CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-6">
          <Card className="h-full">
            <CardHeader title={c.cpd} sub="Lower is better. Best campaign highlighted." action={<Link href="/campaigns" className="text-[12px] font-medium text-accent hover:underline">All campaigns</Link>} />
            <CardBody><HBar label={c.cpdAria} data={cpdRows} format="inr" highlight={cpdRows[0]?.label} labelWidth={168} valueLabel={c.cpdValue} /></CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title={c.firms} sub={c.firmsSub} action={<Link href="/accounts" className="text-[12px] font-medium text-accent hover:underline">{c.firmsLink}</Link>} />
            <DataTable rows={firms} rowKey={(f) => f.id} minWidth={480} caption={c.firmsCaption} columns={[
              { key: "firm", header: c.firmCol, mobile: "title", className: "h-14", cell: (f) => <><Link href={`/accounts/${f.id}`} className="block font-medium text-ink hover:text-accent">{f.name}</Link><span className="hidden text-[12px] text-ink-3 md:inline">{c.firmMeta(f.locality, f.city === "Tiruchirappalli" ? "Trichy" : f.city, f.lawyers)}</span></> },
              { key: "stage", header: "Stage", mobile: "fact", cell: (f) => (f.openStage ? <DealStageBadge stage={f.openStage} /> : null) },
              { key: "score", header: "Best score", align: "right", cell: (f) => f.topScore },
              { key: "value", header: "Open value", align: "right", mobile: "fact", cell: (f) => <span className="font-medium">{inr(f.openValue)}</span> },
            ]} />
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-5">
          <Card className="h-full">
            <CardHeader title={c.team(curMonth)} sub={c.teamSub} />
            <ul className="divide-y divide-line border-t border-line">
              {board.map((r, i) => (
                <li key={r.id} className="grid grid-cols-[20px_1fr_auto] items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="text-[12px] font-semibold text-ink-3 num">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><Avatar name={r.name} size={22} /><span className="truncate text-[13px] font-medium">{masked ? c.rep(i + 1) : r.name}</span></div>
                    <Meter className="mt-2" value={r.won} max={r.target} tone={r.won / r.target >= pace ? "accent" : "warn"} />
                    <div className="mt-1 text-[11px] text-ink-3 num">{c.teamLine(r.demosBooked, r.demosDone, DEMOS_DONE_TARGET, pct(r.sla, 0), inrCompact(r.open))}</div>
                  </div>
                  <div className="text-right"><div className="text-[13px] font-semibold num">{inrCompact(r.won)}</div><div className="text-[11px] text-ink-3 num">of {inrCompact(r.target)}</div></div>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-5 py-3 text-[11px] text-ink-3">{c.territories}: {team.filter((t) => t.role === "sales_rep").map((t) => `${masked ? "Rep" : t.name} (${t.title.split(" · ")[1] ?? c.allTerritory})`).join(", ")}.</p>
          </Card>
        </StaggerItem>
        {hosp && (
          <>
            <StaggerItem className="lg:col-span-6">
              <Card className="h-full">
                <CardHeader title="Enquiries vs bookings by month" sub="Enquiries by month received; bookings by month confirmed" />
                <CardBody><Columns label="Enquiries and bookings by month, last 6 months" data={monthly} xKey="month" height={220} totalLabel={false}
                  series={[{ key: "enquiries", label: "Enquiries", color: "var(--seq-2)" }, { key: "bookings", label: "Bookings", color: "var(--chart-1)" }]} /></CardBody>
              </Card>
            </StaggerItem>
            <StaggerItem className="lg:col-span-6">
              <Card className="h-full">
                <CardHeader title="Occupancy, next 30 days" sub={`Confirmed bookings against ${ROOMS} rooms · average ${occAvg}%`} />
                <CardBody><Columns label="Forward occupancy per day, next 30 days" data={occ} xKey="day" height={220} totalLabel={false} format="pct0"
                  series={[{ key: "occupancy", label: "Occupancy", color: "var(--chart-1)" }]} /></CardBody>
              </Card>
            </StaggerItem>
          </>
        )}
      </Stagger>
    </>
  );
}
