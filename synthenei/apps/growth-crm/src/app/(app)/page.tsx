import Link from "next/link";
import { ArrowRight, Clock, DatabaseBackup, FileClock, UserX } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import {
  SLA_MINUTES, DEAL_STAGES, DEAL_STAGE_LABEL, campaignStats, channelMix, funnel, isDemo, leaderboard, DEMOS_DONE_TARGET, leadsPerDay, pipelineTotals, slaStats, topFirms,
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

export const metadata = { title: "Command Center" };
const DAY = 86400e3;

export default async function CommandCenter() {
  const { ds, now, masked, active } = await pageCtx();
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
  const demos30 = l30.filter(isDemo).length, demosPrev = lPrev.filter(isDemo).length;
  const stats = campaigns.map((c) => campaignStats(c, days, leads, deals));
  const spend30 = days.filter((x) => nowMs - new Date(x.date + "T12:00:00+05:30").getTime() < 30 * DAY).reduce((a, x) => a + x.spend, 0);
  const spendPrev = days.filter((x) => { const t = nowMs - new Date(x.date + "T12:00:00+05:30").getTime(); return t >= 30 * DAY && t < 60 * DAY; }).reduce((a, x) => a + x.spend, 0);
  // Cost per demo by the date the demo was booked (not lead cohort), so recent leads don't look artificially expensive.
  const paidIds = new Set(leads.filter((l) => l.campaignId).map((l) => l.id));
  const booked = (from: number, to: number) => acts.filter((a) => a.kind === "demo_booked" && paidIds.has(a.leadId) && nowMs - new Date(a.at).getTime() >= from * DAY && nowMs - new Date(a.at).getTime() < to * DAY).length;
  const cpd = ratio(spend30, booked(0, 30));
  const cpdPrev = ratio(spendPrev, booked(30, 60));
  const sla = slaStats(l30, now), slaPrev = slaStats(lPrev, now);

  const perDay = leadsPerDay(leads, ga4, 90);
  const trend = perDay.map((p, i) => ({ date: p.date, leads: p.leads, avg: Math.round((perDay.slice(Math.max(0, i - 6), i + 1).reduce((a, x) => a + x.leads, 0) / Math.min(7, i + 1)) * 10) / 10 }));
  const weeklySpark = (fn: (i: number) => number) => Array.from({ length: 8 }, (_, i) => fn(7 - i));
  const leadsWeekly = weeklySpark((w) => inWin(w * 7, w * 7 + 7).length);

  const mix = channelMix(leads, 4);
  const cpdRows = stats.filter((s) => s.demos > 0 && s.spend > 0).map((s) => ({ label: s.name.split(" — ")[0], value: Math.round(s.costPerDemo), note: `${s.demos} demos from ${inrCompact(s.spend)} spend` })).sort((a, b) => a.value - b.value);
  const steps = funnel(leads, ga4, 90);
  const firms = topFirms(accounts, deals, leads, 6);
  const board = leaderboard(team, deals, leads, acts, now);
  const open = deals.filter((x) => x.stage !== "won" && x.stage !== "lost");
  const byStage = DEAL_STAGES.filter((s) => s !== "won" && s !== "lost").map((s, i) => ({ s, v: open.filter((x) => x.stage === s).reduce((a, x) => a + x.value, 0), c: [`var(--seq-1)`, `var(--seq-2)`, `var(--seq-3)`, `var(--accent-on-navy)`, `var(--chart-5)`][i] }));

  const closing = [...open].filter((x) => x.stage === "proposal" || x.stage === "negotiation").sort((a, b) => a.expectedClose.localeCompare(b.expectedClose)).slice(0, 3);
  const unanswered = leads.filter((l) => l.firstResponseMins === null && nowMs - new Date(l.createdAt).getTime() > SLA_MINUTES * 60e3);
  const staleProposals = deals.filter((x) => (x.stage === "proposal" || x.stage === "negotiation") && nowMs - new Date(x.stageEnteredAt).getTime() > 7 * DAY);
  const quietBy = new Map<string, number>();
  accounts.filter((a) => a.status === "prospect" && nowMs - new Date(a.lastActivityAt).getTime() > 5 * DAY).forEach((a) => quietBy.set(a.city, (quietBy.get(a.city) ?? 0) + 1));
  const [quietCity, quietN] = [...quietBy.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  const districtCount = new Set(accounts.map((a) => a.district)).size;
  /** Delta only when the base is big enough to mean something. */
  const delta = (cur: number, prev: number, minBase = 5) => (prev >= minBase ? ratio(cur - prev, prev) : undefined);

  return (
    <>
      <PageHeader eyebrow={`${fmtWeekday(now)}, ${fmtDate(now)} · IST`} title="Command Center"
        sub={`Revenue, pipeline and the campaigns feeding them, for law firms across ${districtCount} districts: ${active.ws.region.replace(/ · /g, ", ")}.`} />

      {/* alerts strip: specific, actionable, never generic */}
      <Stagger className="mb-6 flex flex-wrap gap-2">
        {[
          unanswered.length ? { icon: UserX, tone: "danger", text: `${unanswered.length} lead${unanswered.length === 1 ? "" : "s"} past the 2-hour first-response SLA without a reply`, href: "/leads?view=sla" } : { icon: UserX, tone: "ok", text: "Every new lead got a first reply within the 2-hour SLA", href: "/leads?view=sla" },
          { icon: Clock, tone: "warn", text: quietN ? `${quietN} ${quietCity === "Tiruchirappalli" ? "Trichy" : quietCity} ${quietN === 1 ? "firm has" : "firms have"} had no contact in 5+ days` : "Every prospect firm was contacted in the last 5 days", href: quietN ? `/accounts?city=${quietCity}` : "/accounts" },
          { icon: FileClock, tone: "warn", text: `${staleProposals.length} proposal${staleProposals.length === 1 ? "" : "s"} with no reply for 7+ days`, href: "/pipeline" },
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
                <div className="text-[12px] font-medium text-navy-ink-2">Open pipeline</div>
                <div className="mt-1 text-[34px] font-semibold leading-10 tracking-[-0.025em] num">{inr(tot.openValue)}</div>
                <div className="mt-1 text-[12px] text-navy-ink-3 num">{tot.openCount} deals · weighted {inrCompact(tot.weighted)} · win rate {pct(tot.winRate, 0)}</div>
              </div>
            </div>
            <div>
              <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-[3px]" role="img" aria-label="Open pipeline value by stage">
                {byStage.filter((b) => b.v > 0).map((b) => <div key={b.s} style={{ flexGrow: b.v, background: b.c }} title={`${DEAL_STAGE_LABEL[b.s]}: ${inr(b.v)}`} />)}
              </div>
              <ul className="mt-2.5 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                {byStage.map((b) => (
                  <li key={b.s} className="flex items-center justify-between gap-2 text-navy-ink-2">
                    <span className="flex items-center gap-1.5 truncate"><span className="size-2 shrink-0 rounded-[2px]" style={{ background: b.c }} />{DEAL_STAGE_LABEL[b.s]}</span>
                    <span className="num text-navy-ink">{inrCompact(b.v)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-navy-ink-3">Closing next</div>
              <ul className="divide-y divide-navy-line/70 text-[12px]">
                {closing.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0 truncate text-navy-ink-2"><span className="text-navy-ink">{accounts.find((a) => a.id === c.accountId)?.name}</span> · {DEAL_STAGE_LABEL[c.stage]}</span>
                    <span className="shrink-0 num text-navy-ink-2">{fmtDate(c.expectedClose)} · <span className="font-medium text-navy-ink">{inrCompact(c.value)}</span></span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-auto border-t border-navy-line pt-4">
              <TargetBar tone="navy" value={tot.wonMonthValue} target={teamTarget} pace={pace} label={`Won in October · ${tot.wonMonthCount} deals`} format="inrCompact" />
            </div>
          </NavyPanel>
        </StaggerItem>

        <StaggerItem className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
          <Kpi label="Won this month" metric="M42" value={tot.wonMonthValue} format="inr" delta={tot.wonPrevValue > 0 ? ratio(tot.wonMonthValue - tot.wonPrevValue, tot.wonPrevValue) : undefined} deltaLabel="vs September"
            foot={Number.isFinite(tot.avgDeal) ? <>Avg deal {inrCompact(tot.avgDeal)} · annual seats, placeholder prices</> : <>No deals won yet in this workspace</>} />
          <Kpi label="New leads (30 days)" metric="M5" value={l30.length} delta={delta(l30.length, lPrev.length)} spark={leadsWeekly}
            foot={<>{num(lPrev.length)} in the previous 30 days</>} />
          <Kpi label="Lead → demo" metric="M12" value={ratio(demos30, l30.length)} format="pct" delta={lPrev.length >= 10 ? ratio(demos30, l30.length) - ratio(demosPrev, lPrev.length) : undefined} deltaLabel="pts vs prev."
            foot={<>{demos30} demos from {l30.length} leads</>} />
          <Kpi label="Cost per demo" metric="M11" value={cpd} format="inr" delta={booked(30, 60) >= 5 ? ratio(cpd - cpdPrev, cpdPrev) : undefined} goodWhen="down"
            foot={<>{booked(0, 30)} paid demos booked · spend {inrCompact(spend30)} · SLA met {pct(sla.within, 0)} (median {minsToHuman(sla.median)}, prev. {pct(slaPrev.within, 0)})</>} />
        </StaggerItem>

        <StaggerItem className="lg:col-span-8">
          <Card className="h-full">
            <CardHeader title="Leads per day" sub="All channels, created date (IST). Line = 7-day average." />
            <CardBody>
              <LineTrend label="Leads per day, last 90 days, with 7-day average" height={248} yFormat="num"
                data={trend} series={[{ key: "leads", label: "Leads that day", color: "var(--seq-1)", bar: true }, { key: "avg", label: "7-day average", color: "var(--chart-1)", area: true }]} />
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title="Channel mix" sub="Leads by first-touch channel, top 4 + other" />
            <CardBody><Donut label="Share of leads by channel" data={mix} centerValue={num(leads.length)} centerLabel="leads" /></CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-6">
          <Card className="h-full">
            <CardHeader title="Funnel: visit to won" sub="Cohort of the last 90 days" />
            <CardBody><Funnel steps={steps} /></CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-6">
          <Card className="h-full">
            <CardHeader title="Cost per demo by campaign" sub="Lower is better. Best campaign highlighted." action={<Link href="/campaigns" className="text-[12px] font-medium text-accent hover:underline">All campaigns</Link>} />
            <CardBody><HBar label="Cost per demo booked by campaign in rupees" data={cpdRows} format="inr" highlight={cpdRows[0]?.label} labelWidth={168} valueLabel="Cost per demo" /></CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title="Top firms in pipeline" sub="Open deal value, best lead score at the firm" action={<Link href="/accounts" className="text-[12px] font-medium text-accent hover:underline">Law firms</Link>} />
            <DataTable rows={firms} rowKey={(f) => f.id} minWidth={480} caption="Top firms by open pipeline value" columns={[
              { key: "firm", header: "Firm", mobile: "title", className: "h-14", cell: (f) => <><Link href={`/accounts/${f.id}`} className="block font-medium text-ink hover:text-accent">{f.name}</Link><span className="hidden text-[12px] text-ink-3 md:inline">{f.locality}, {f.city === "Tiruchirappalli" ? "Trichy" : f.city} · {f.lawyers} lawyers</span></> },
              { key: "stage", header: "Stage", mobile: "fact", cell: (f) => (f.openStage ? <DealStageBadge stage={f.openStage} /> : null) },
              { key: "score", header: "Best score", align: "right", cell: (f) => f.topScore },
              { key: "value", header: "Open value", align: "right", mobile: "fact", cell: (f) => <span className="font-medium">{inr(f.openValue)}</span> },
            ]} />
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-5">
          <Card className="h-full">
            <CardHeader title="Team in October" sub="Won vs monthly target · demos booked this month · SLA on leads from the last 30 days" />
            <ul className="divide-y divide-line border-t border-line">
              {board.map((r, i) => (
                <li key={r.id} className="grid grid-cols-[20px_1fr_auto] items-center gap-3 px-4 py-3 sm:px-5">
                  <span className="text-[12px] font-semibold text-ink-3 num">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><Avatar name={r.name} size={22} /><span className="truncate text-[13px] font-medium">{masked ? `Rep ${i + 1}` : r.name}</span></div>
                    <Meter className="mt-2" value={r.won} max={r.target} tone={r.won / r.target >= pace ? "accent" : "warn"} />
                    <div className="mt-1 text-[11px] text-ink-3 num">{r.demosBooked} demos booked · {r.demosDone}/{DEMOS_DONE_TARGET} done · SLA {pct(r.sla, 0)} · open {inrCompact(r.open)}</div>
                  </div>
                  <div className="text-right"><div className="text-[13px] font-semibold num">{inrCompact(r.won)}</div><div className="text-[11px] text-ink-3 num">of {inrCompact(r.target)}</div></div>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-5 py-3 text-[11px] text-ink-3">Territories: {team.filter((t) => t.role === "sales_rep").map((t) => `${masked ? "Rep" : t.name} (${t.title.split(" · ")[1] ?? "all districts"})`).join(", ")}.</p>
          </Card>
        </StaggerItem>
      </Stagger>
    </>
  );
}
