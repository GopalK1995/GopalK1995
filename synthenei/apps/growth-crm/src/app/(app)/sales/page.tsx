import Link from "next/link";
import { AlertTriangle, CalendarDays, Clock, Inbox, MessageCircle, Phone, Mail, Video, FileText, Hourglass } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import { DEAL_STAGES, DEAL_STAGE_LABEL, LEAD_STAGES, SLA_MINUTES, channelMix, isDemo, slaStats } from "@/lib/data/metrics";
import { dayKey, fmtDate, fmtTime, fmtWeekday, inrCompact, minsToHuman, num, pct, ratio, relTime } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Kpi } from "@/components/ui/kpi";
import { PageHeader, ScoreChip } from "@/components/ui/misc";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { QuickActions } from "@/components/quick-actions";
import { RepSwitcher } from "./rep-switcher";
import { HBar } from "@/components/charts/hbar";
import { Columns } from "@/components/charts/columns";
import { Donut } from "@/components/charts/donut";
import { TargetBar } from "@/components/charts/target";
import { cn } from "@/lib/utils";
import type { Task } from "@/lib/data/types";

export const metadata = { title: "My day" };
const KIND_ICON: Record<Task["kind"], typeof Phone> = { call: Phone, whatsapp: MessageCircle, email: Mail, demo: Video, follow_up: Clock, proposal: FileText };
const DAY = 86400e3;

export default async function MyDay({ searchParams }: { searchParams: Promise<{ rep?: string }> }) {
  const { ds, now, session, role } = await pageCtx();
  const sp = await searchParams;
  const [allLeads, allDeals, allTasks, team, accounts, acts, convs] = await Promise.all([ds.leads(), ds.deals(), ds.tasks(), ds.team(), ds.accounts(), ds.activities(), ds.conversations()]);
  const reps = team.filter((t) => t.role === "sales_rep");
  const repId = role === "sales_rep" ? session.uid : reps.find((r) => r.id === sp.rep)?.id ?? reps[0].id;
  const rep = team.find((t) => t.id === repId)!;
  const nowMs = new Date(now).getTime();
  const today = dayKey(now);

  const leads = allLeads.filter((l) => l.ownerId === repId);
  const deals = allDeals.filter((d) => d.ownerId === repId);
  const tasks = allTasks.filter((t) => t.ownerId === repId && t.status === "open");
  const leadOf = (id: string | null) => allLeads.find((l) => l.id === id);
  const firmOf = (id?: string) => accounts.find((a) => a.id === id);

  // W1 + W2
  const touch = tasks.filter((t) => ["call", "whatsapp", "email", "follow_up"].includes(t.kind) && dayKey(t.dueAt) <= today).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const overdue = tasks.filter((t) => t.dueAt < now && dayKey(t.dueAt) < today);
  const oldest = overdue.length ? Math.ceil((nowMs - new Date(overdue[0].dueAt).getTime()) / DAY) : 0;
  // W3
  const l30 = leads.filter((l) => nowMs - new Date(l.createdAt).getTime() < 30 * DAY);
  const sla = slaStats(l30, now);
  const teamSla = slaStats(allLeads.filter((l) => nowMs - new Date(l.createdAt).getTime() < 30 * DAY), now);
  const slaSpark = Array.from({ length: 8 }, (_, w) => { const ls = leads.filter((l) => { const a = (nowMs - new Date(l.createdAt).getTime()) / DAY; return a >= (7 - w) * 7 && a < (8 - w) * 7; }); return ls.length ? slaStats(ls, now).within * 100 : 60; });
  // W4
  const hot = leads.filter((l) => l.score >= 70 && l.stage !== "won" && l.stage !== "lost").sort((a, b) => b.score - a.score).slice(0, 6);
  // W5: Mon–Sat of this week
  const d0 = new Date(today + "T00:00:00Z"); const dow = (d0.getUTCDay() + 6) % 7;
  const week = Array.from({ length: 6 }, (_, i) => new Date(d0.getTime() + (i - dow) * DAY).toISOString().slice(0, 10));
  const demos = allTasks.filter((t) => t.ownerId === repId && t.kind === "demo" && week.includes(dayKey(t.dueAt))).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const demoCols = week.map((d) => ({ day: `${fmtWeekday(d + "T06:00:00Z")} ${Number(d.slice(8))}`, demos: demos.filter((t) => dayKey(t.dueAt) === d).length }));
  // W6
  const open = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const byStage = DEAL_STAGES.filter((s) => s !== "won" && s !== "lost").map((s) => ({ label: DEAL_STAGE_LABEL[s], value: open.filter((d) => d.stage === s).reduce((a, d) => a + d.value, 0), note: `${open.filter((d) => d.stage === s).length} deals` }));
  // W7
  const month = now.slice(0, 7);
  const wonM = deals.filter((d) => d.stage === "won" && d.wonAt?.slice(0, 7) === month).reduce((a, d) => a + d.value, 0);
  const demosDoneM = acts.filter((a) => a.kind === "demo_done" && a.byId === repId && a.at.slice(0, 7) === month).length;
  const dt = new Date(now); const dim = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  const pace = dt.getUTCDate() / dim;
  // W8
  const order = LEAD_STAGES;
  const reached = (s: string) => leads.filter((l) => (l.stage === "lost" ? 1 : order.indexOf(l.stage)) >= order.indexOf(s as never)).length;
  const conv = [["Lead", leads.length], ["Contacted", reached("contacted")], ["Demo booked", reached("demo_booked")], ["Proposal", reached("proposal")], ["Won", reached("won")]] as const;
  // W9 weekly activity by type, 8 weeks
  const mine = acts.filter((a) => a.byId === repId || leads.some((l) => l.id === a.leadId && (a.kind === "whatsapp_out" || a.kind === "email_sent")));
  const weeks = Array.from({ length: 8 }, (_, w) => {
    const from = nowMs - (8 - w) * 7 * DAY, to = from + 7 * DAY;
    const inW = mine.filter((a) => { const t = new Date(a.at).getTime(); return t >= from && t < to; });
    return { week: fmtDate(new Date(from + DAY).toISOString()), call: inW.filter((a) => a.kind === "call").length, whatsapp: inW.filter((a) => a.kind === "whatsapp_out").length, email: inW.filter((a) => a.kind === "email_sent" || a.kind === "proposal_sent").length, meeting: inW.filter((a) => a.kind === "demo_booked" || a.kind === "demo_done").length };
  });
  // W10–W12
  const unread = convs.filter((c) => leadOf(c.leadId)?.ownerId === repId && c.unread > 0);
  const stuck = open.filter((d) => nowMs - new Date(d.stageEnteredAt).getTime() > 10 * DAY).sort((a, b) => a.stageEnteredAt.localeCompare(b.stageEnteredAt));
  const mix = channelMix(l30.length >= 5 ? l30 : leads, 4);

  return (
    <>
      <PageHeader eyebrow={`${fmtWeekday(now)}, ${fmtDate(now)} · ${rep.title}`} title={role === "sales_rep" ? `Good morning, ${rep.name.split(" ")[0]}` : `${rep.name}'s day`}
        sub={`${touch.length} touches due today, ${overdue.length} overdue, ${demos.filter((t) => dayKey(t.dueAt) >= today).length} demos left this week.`}
        actions={role !== "sales_rep" ? <RepSwitcher reps={reps.map((r) => ({ id: r.id, name: r.name }))} value={repId} /> : undefined} />

      <Stagger className="grid gap-4 lg:grid-cols-12">
        {/* W1 */}
        <StaggerItem className="lg:col-span-8">
          <Card className="h-full">
            <CardHeader title="Today's touch list" sub="Calls, WhatsApps and emails due today, overdue first" action={<span className="text-[12px] text-ink-3 num">{touch.length} due · <span className={overdue.length ? "font-medium text-danger" : ""}>{overdue.length} overdue</span></span>} />
            <ul className="divide-y divide-line border-t border-line">
              {touch.slice(0, 9).map((t) => {
                const l = leadOf(t.leadId); const f = firmOf(l?.accountId); const I = KIND_ICON[t.kind]; const late = dayKey(t.dueAt) < today;
                return (
                  <li key={t.id} className="grid grid-cols-[32px_1fr_auto] items-center gap-3 px-4 py-2.5 hover:bg-paper/60 sm:px-5">
                    <span className={cn("grid size-8 place-items-center rounded-sm border", late ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-paper text-ink-2")}><I className="size-4" aria-hidden /></span>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <Link href={`/leads/${l?.id}`} className="truncate text-[13px] font-medium text-ink hover:text-accent">{l?.name}</Link>
                        {l && <ScoreChip score={l.score} />}
                      </div>
                      <div className="truncate text-[12px] text-ink-3">{t.title} · {f?.name}, {f?.city === "Tiruchirappalli" ? "Trichy" : f?.city}</div>
                    </div>
                    <div className="text-right text-[12px]">
                      <div className={cn("font-medium num", late ? "text-danger" : "text-ink")}>{late ? `${Math.ceil((nowMs - new Date(t.dueAt).getTime()) / DAY)}d late` : fmtTime(t.dueAt)}</div>
                      <div className="text-ink-3">last touch {l ? relTime(l.lastTouchAt, now) : "—"}</div>
                    </div>
                  </li>
                );
              })}
              {!touch.length && <li className="px-5 py-8 text-center text-[13px] text-ink-3">Nothing due today. Check hot leads on the right.</li>}
            </ul>
          </Card>
        </StaggerItem>
        {/* W2 + W3 */}
        <StaggerItem className="flex flex-col gap-4 lg:col-span-4">
          <div className="grid grid-cols-2 gap-4">
          <Link href="/tasks" className={cn("flex flex-col justify-between rounded-md border p-4 shadow-1", overdue.length ? "border-danger/30 bg-danger-soft" : "border-line bg-surface")}>
            <span className="flex items-center justify-between text-[12px] font-medium text-ink-2">Overdue<AlertTriangle className={cn("size-4", overdue.length ? "text-danger" : "text-ink-3")} aria-hidden /></span>
            <span className={cn("mt-2 text-[28px] font-semibold leading-8 num", overdue.length ? "text-danger" : "text-ink")}>{overdue.length}</span>
            <span className="text-[12px] text-ink-3">{overdue.length ? `oldest ${oldest} day${oldest > 1 ? "s" : ""}` : "all caught up"}</span>
          </Link>
          <Link href="/leads?view=sla" className="rounded-md border border-line bg-surface p-4 shadow-1">
            <span className="flex items-center justify-between text-[12px] font-medium text-ink-2">Unread inbox<Inbox className="size-4 text-ink-3" aria-hidden /></span>
            <span className="mt-2 block text-[28px] font-semibold leading-8 num">{unread.reduce((a, c) => a + c.unread, 0)}</span>
            <span className="text-[12px] text-ink-3">{unread.length} conversation{unread.length === 1 ? "" : "s"} · WhatsApp window open</span>
          </Link>
          </div>
          <Kpi label={`First-response SLA (${SLA_MINUTES / 60} business hours)`} metric="M14" value={sla.within} format="pct" spark={slaSpark}
            foot={<>Median {minsToHuman(sla.median)} · team {pct(teamSla.within, 0)} · last 30 days, n={sla.n}</>} />
          <div className="rounded-md border border-line bg-surface p-4 shadow-1">
            <div className="text-[12px] font-medium text-ink-2">Quick log</div>
            <p className="mt-1 text-[12px] text-ink-3">Log the outcome right after each call so the SLA clock and the touch list stay true.</p>
            <div className="mt-3"><QuickActions size="sm" /></div>
          </div>
        </StaggerItem>

        {/* W4 */}
        <StaggerItem className="lg:col-span-5">
          <Card className="h-full">
            <CardHeader title="Hot leads" sub="Score 70+, with the two strongest factors" action={<span className="font-mono text-[10px] text-ink-3">M32</span>} />
            <ul className="divide-y divide-line border-t border-line">
              {hot.map((l) => {
                const top = [...l.scoreFactors].sort((a, b) => b.points - a.points).slice(0, 2);
                return (
                  <li key={l.id} className="px-4 py-2.5 sm:px-5">
                    <div className="flex items-center justify-between gap-3">
                      <Link href={`/leads/${l.id}`} className="min-w-0 truncate text-[13px] font-medium hover:text-accent">{l.name} <span className="font-normal text-ink-3">· {firmOf(l.accountId)?.name}</span></Link>
                      <span className="text-[13px] font-semibold num">{l.score}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-paper-2"><div className="h-full rounded-full bg-accent" style={{ width: `${l.score}%` }} /></div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">{top.map((f) => <Badge key={f.label} tone="neutral">{f.label} +{f.points}</Badge>)}</div>
                  </li>
                );
              })}
              {!hot.length && <li className="px-5 py-6 text-[13px] text-ink-3">No leads above 70 yet. Scores rise with pricing-page visits and WhatsApp replies.</li>}
            </ul>
          </Card>
        </StaggerItem>
        {/* W5 */}
        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title="Demos this week" sub="Monday to Saturday, IST" action={<span className="font-mono text-[10px] text-ink-3">M33</span>} />
            <CardBody>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {week.map((d) => {
                  const ds_ = demos.filter((t) => dayKey(t.dueAt) === d); const isToday = d === today;
                  return (
                    <div key={d} className={cn("min-h-[104px] rounded-sm border p-2", isToday ? "border-accent bg-accent-soft/50" : d < today ? "border-line bg-paper/60" : "border-line")}>
                      <div className={cn("text-[11px] font-medium", isToday ? "text-accent" : "text-ink-3")}>{fmtWeekday(d + "T06:00:00Z")} {Number(d.slice(8))}</div>
                      <div className="mt-1.5 space-y-1">
                        {ds_.map((t) => <Link key={t.id} href={`/leads/${t.leadId}`} className="block rounded-[4px] bg-navy-900 px-1.5 py-1 text-[11px] leading-4 text-navy-ink hover:bg-navy-800"><span className="num text-accent-on-navy">{fmtTime(t.dueAt)}</span><span className="block truncate">{t.title.replace("Demo: ", "")}</span></Link>)}
                        {!ds_.length && <span className="text-[11px] text-ink-3">—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4"><Columns label="Demos per day this week" data={demoCols} xKey="day" series={[{ key: "demos", label: "Demos", color: "var(--chart-1)" }]} height={120} /></div>
            </CardBody>
          </Card>
        </StaggerItem>

        {/* W6, W7, W8 */}
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title="My pipeline by stage" sub={`${open.length} open deals · ${inrCompact(open.reduce((a, d) => a + d.value, 0))}`} action={<span className="font-mono text-[10px] text-ink-3">M34</span>} />
            <CardBody><HBar label="My open pipeline value by stage" data={byStage} format="inrCompact" highlight="all" labelWidth={108} valueLabel="Value" /></CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title="Target vs achieved" sub="October, pace tick = share of month gone" action={<span className="font-mono text-[10px] text-ink-3">M38</span>} />
            <CardBody className="space-y-5">
              <TargetBar label="Won value" value={wonM} target={rep.monthlyTarget} pace={pace} format="inrCompact" />
              <TargetBar label="Demos done" value={demosDoneM} target={8} pace={pace} format="num" />
              <p className="text-[11px] text-ink-3">Targets set by your manager in Settings → Pipeline. Team median attainment shown on the Command Center.</p>
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title="My conversion" sub="Last 90 days, cohort by lead created" action={<span className="font-mono text-[10px] text-ink-3">M12 · M36</span>} />
            <CardBody>
              <ol className="space-y-2">
                {conv.map(([label, n], i) => (
                  <li key={label} className="grid grid-cols-[88px_1fr_64px] items-center gap-2 text-[12px]">
                    <span className="text-ink-2">{label}</span>
                    <div className="h-5 rounded-[3px] bg-paper-2"><div className="flex h-full items-center rounded-[3px] bg-seq-3 px-1.5 text-[11px] font-semibold text-ink num" style={{ width: `${Math.max(8, (n / conv[0][1]) * 100)}%` }}>{n}</div></div>
                    <span className="text-right num text-ink-3">{i ? pct(ratio(n, conv[i - 1][1]), 0) : "—"}{i && conv[i - 1][1] < 20 ? <span className="block text-[10px]">low n</span> : null}</span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </StaggerItem>

        {/* W9, W11, W12 */}
        <StaggerItem className="lg:col-span-5">
          <Card className="h-full">
            <CardHeader title="Weekly activity" sub="Logged touches, last 8 weeks" action={<span className="font-mono text-[10px] text-ink-3">M40</span>} />
            <CardBody>
              <Columns label="Weekly activity by type, last 8 weeks" data={weeks} xKey="week" height={200}
                series={[{ key: "call", label: "Calls", color: "var(--chart-1)" }, { key: "whatsapp", label: "WhatsApp", color: "var(--chart-3)" }, { key: "email", label: "Email", color: "var(--chart-2)" }, { key: "meeting", label: "Demos", color: "var(--chart-4)" }]} />
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-3">
          <Card className="h-full">
            <CardHeader title="My leads by source" sub="First touch" action={<span className="font-mono text-[10px] text-ink-3">M18</span>} />
            <CardBody><Donut label="My leads by source channel" data={mix} centerValue={num(mix.reduce((a, m) => a + m.n, 0))} centerLabel="leads" size={132} /></CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title="Stuck deals" sub="More than 10 days in the current stage" action={<span className="font-mono text-[10px] text-ink-3">M41</span>} />
            <ul className="divide-y divide-line border-t border-line">
              {stuck.slice(0, 5).map((d) => {
                const age = Math.floor((nowMs - new Date(d.stageEnteredAt).getTime()) / DAY);
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0"><Link href={`/leads/${d.leadId}`} className="block truncate text-[13px] font-medium hover:text-accent">{firmOf(d.accountId)?.name}</Link><span className="text-[12px] text-ink-3">{DEAL_STAGE_LABEL[d.stage]} · {inrCompact(d.value)}</span></div>
                    <Badge tone={age > 14 ? "danger" : "warn"}><Hourglass />{age}d</Badge>
                  </li>
                );
              })}
              {!stuck.length && <li className="px-5 py-6 text-[13px] text-ink-3">No deal has sat in one stage for more than 10 days.</li>}
            </ul>
          </Card>
        </StaggerItem>
      </Stagger>
      <p className="mt-6 flex items-center gap-1.5 text-[11px] text-ink-3"><CalendarDays className="size-3.5" aria-hidden />Working hours 10:00–19:00 IST, Monday to Saturday. Court hours (10:30–17:00) are the worst time to call partners.</p>
    </>
  );
}
