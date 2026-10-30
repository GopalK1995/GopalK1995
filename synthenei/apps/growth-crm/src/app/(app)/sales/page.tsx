import Link from "next/link";
import { AlertTriangle, CalendarDays, Clock, Inbox, MessageCircle, Phone, Mail, Video, FileText, Hourglass } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import { DEAL_STAGES, DEMOS_DONE_TARGET, LEAD_STAGES, SLA_MINUTES, channelMix, repMonth, slaStats } from "@/lib/data/metrics";
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
import { vocabFor } from "@/lib/vertical";
import { normTasks } from "../tasks/_lib/rows";
import { tt } from "../tasks/_lib/strings";
import { DayRuler } from "./day-ruler";

export const metadata = { title: "My day" };
const KIND_ICON: Record<Task["kind"], typeof Phone> = { call: Phone, whatsapp: MessageCircle, email: Mail, demo: Video, follow_up: Clock, proposal: FileText };
const DAY = 86400e3;

export default async function MyDay({ searchParams }: { searchParams: Promise<{ rep?: string }> }) {
  const { ds, now, session, role, active, stageOrder } = await pageCtx();
  const v = vocabFor(active.tenant), m = v.md, hosp = v.id === "hospitality";
  const sp = await searchParams;
  const [allLeads, allDeals, rawTasks, team, accounts, acts, convs, holidays] = await Promise.all([ds.leads(), ds.deals(), ds.tasks(), ds.team(), ds.accounts(), ds.activities(), ds.conversations(), ds.holidays().catch(() => [])]);
  const allTasks = normTasks(rawTasks); // real rows use assigneeId/numeric priority; normalised once for every widget below
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
  function touch_overdue() { return touch.filter((t) => dayKey(t.dueAt) < today); }
  const touch = tasks.filter((t) => ["call", "whatsapp", "email", "follow_up"].includes(t.kind) && dayKey(t.dueAt) <= today).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const overdue = touch_overdue();
  const oldest = overdue.length ? Math.ceil((nowMs - new Date(overdue[0].dueAt).getTime()) / DAY) : 0;
  // W3
  const l30 = leads.filter((l) => nowMs - new Date(l.createdAt).getTime() < 30 * DAY);
  const sla = slaStats(l30, now); // same definition as repMonth().sla
  const teamSla = slaStats(allLeads.filter((l) => nowMs - new Date(l.createdAt).getTime() < 30 * DAY), now);
  const slaSpark = Array.from({ length: 8 }, (_, w) => { const ls = leads.filter((l) => { const a = (nowMs - new Date(l.createdAt).getTime()) / DAY; return a >= (7 - w) * 7 && a < (8 - w) * 7; }); return ls.length ? slaStats(ls, now).within * 100 : 60; });
  // W4
  const hot = leads.filter((l) => l.score >= 70 && l.stage !== "won" && l.stage !== "lost").sort((a, b) => b.score - a.score).slice(0, 6);
  // W5: Mon–Sat of this week
  const d0 = new Date(today + "T00:00:00Z"); const dow = (d0.getUTCDay() + 6) % 7;
  const week = Array.from({ length: m.days }, (_, i) => new Date(d0.getTime() + (i - dow) * DAY).toISOString().slice(0, 10));
  // Hospitality: arrivals = this rep's confirmed bookings by check-in date (shaped like the demo tasks).
  const demos = hosp
    ? allDeals.filter((d) => d.ownerId === repId && d.stage === "won" && d.stay && d.stay.status !== "cancelled" && week.includes(d.stay.checkIn))
        .map((d) => ({ id: d.id, leadId: d.leadId, title: `${accounts.find((a) => a.id === d.accountId)?.name ?? d.name} · ${d.seats}n`, dueAt: d.stay!.checkIn + "T07:30:00Z" } as Pick<Task, "id" | "leadId" | "title" | "dueAt">))
    : allTasks.filter((t) => t.ownerId === repId && t.kind === "demo" && week.includes(dayKey(t.dueAt))).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const demoCols = week.map((d) => ({ day: `${fmtWeekday(d + "T06:00:00Z")} ${Number(d.slice(8))}`, demos: demos.filter((t) => hosp ? t.dueAt.slice(0, 10) === d : dayKey(t.dueAt) === d).length }));
  // W6
  const open = deals.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const byStage = stageOrder.deal.filter((s) => s !== "won" && s !== "lost").map((s) => ({ label: v.dealStage[s], value: open.filter((d) => d.stage === s).reduce((a, d) => a + d.value, 0), note: m.pipeNote(open.filter((d) => d.stage === s).length) }));
  // W7
  const month = now.slice(0, 7);
  const rm = repMonth(repId, allDeals, allLeads, acts, now);
  const wonM = rm.won, demosDoneM = rm.demosDone;
  const dt = new Date(now); const dim = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  const pace = dt.getUTCDate() / dim;
  // W8
  const order = LEAD_STAGES;
  const reached = (s: string) => leads.filter((l) => (l.stage === "lost" ? 1 : order.indexOf(l.stage)) >= order.indexOf(s as never)).length;
  const conv = m.conv.map(([label, key], i) => [label, i === 0 ? leads.length : reached(key)] as [string, number]);
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
  // Hospitality extras: replies due today and quotes waiting on an advance.
  const repliesDue = leads.filter((l) => l.stage !== "won" && l.stage !== "lost" && l.nextActionAt && dayKey(l.nextActionAt) <= today).sort((a, b) => a.nextActionAt!.localeCompare(b.nextActionAt!)).slice(0, 6);
  const awaiting = open.filter((d) => d.stage === "proposal" || d.stage === "demo_done").sort((a, b) => a.stageEnteredAt.localeCompare(b.stageEnteredAt)).slice(0, 6);
  const mix = channelMix(l30.length >= 5 ? l30 : leads, 4, v.channelFamily);

  return (
    <>
      <PageHeader eyebrow={`${fmtWeekday(now)}, ${fmtDate(now)} · ${rep.title}`} title={role === "sales_rep" ? `Good morning, ${rep.name.split(" ")[0]}` : `${rep.name}'s day`}
        sub={m.sub(touch.length, overdue.length, demos.filter((t) => (hosp ? t.dueAt.slice(0, 10) : dayKey(t.dueAt)) >= today).length)}
        actions={role !== "sales_rep" ? <RepSwitcher reps={reps.map((r) => ({ id: r.id, name: r.name }))} value={repId} /> : undefined} />

      <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* W1 */}
        <StaggerItem className="lg:col-span-8">
          <Card className="h-full">
            <CardHeader title="Today's touch list" sub="Calls, WhatsApps and emails due today, overdue first" action={<span className="text-[12px] text-ink-3 num">{touch.length} due · <span className={overdue.length ? "font-medium text-danger" : ""}>{overdue.length} overdue</span></span>} />
            <ul className="divide-y divide-line border-t border-line">
              {touch.map((t) => {
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
              {!touch.length && <li className="px-5 py-8 text-center text-[13px] text-ink-3">{m.nothing}</li>}
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
          <Kpi label={m.slaLabel(SLA_MINUTES / 60)} metric="M14" value={sla.within} format="pct" spark={slaSpark}
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
            <CardHeader title={m.hot} sub="Score 70+, with the two strongest factors" />
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
              {!hot.length && <li className="px-5 py-6 text-[13px] text-ink-3">{m.hotNone}</li>}
            </ul>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-12"><DayRuler now={now} tasks={tasks} holidays={holidays} t={tt(v)} /></StaggerItem>
        {/* W5 */}
        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title={m.wk} sub={m.wkSub} />
            <CardBody>
              <div className={cn("grid grid-cols-3 gap-2", hosp ? "sm:grid-cols-7" : "sm:grid-cols-6")}>
                {week.map((d) => {
                  const ds_ = demos.filter((t) => (hosp ? t.dueAt.slice(0, 10) : dayKey(t.dueAt)) === d); const isToday = d === today;
                  return (
                    <div key={d} className={cn("min-h-[104px] rounded-sm border p-2", isToday ? "border-accent bg-accent-soft/50" : d < today ? "border-line bg-paper/60" : "border-line")}>
                      <div className={cn("text-[11px] font-medium", isToday ? "text-accent" : "text-ink-3")}>{fmtWeekday(d + "T06:00:00Z")} {Number(d.slice(8))}</div>
                      <div className="mt-1.5 space-y-1">
                        {ds_.map((t) => <Link key={t.id} href={`/leads/${t.leadId}`} className="block rounded-[4px] bg-navy-900 px-1.5 py-1 text-[11px] leading-4 text-navy-ink hover:bg-navy-800">{!hosp && <span className="num text-accent-on-navy">{fmtTime(t.dueAt)}</span>}<span className="block truncate">{t.title.replace("Demo: ", "")}</span></Link>)}
                        {!ds_.length && <span className="text-[11px] text-ink-3">—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4"><Columns label={m.wkAria} data={demoCols} xKey="day" series={[{ key: "demos", label: m.wkSeries, color: "var(--chart-1)" }]} height={120} /></div>
            </CardBody>
          </Card>
        </StaggerItem>

        {/* W6, W7, W8 */}
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title={m.pipe} sub={m.pipeSub(open.length, inrCompact(open.reduce((a, d) => a + d.value, 0)))} />
            <CardBody><HBar label={m.pipeAria} data={byStage} format="inrCompact" highlight="all" labelWidth={108} valueLabel="Value" /></CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title={m.target} sub={m.targetSub(new Date(now).toLocaleString("en-IN", { month: "long", timeZone: "UTC" }))} />
            <CardBody className="space-y-5">
              <TargetBar label={m.won} value={wonM} target={rep.monthlyTarget} pace={pace} format="inrCompact" />
              <TargetBar label={m.done} value={demosDoneM} target={DEMOS_DONE_TARGET} pace={pace} format="num" />
              <p className="text-[11px] text-ink-3">Targets set by your manager in Settings → Pipeline. Team median attainment shown on the Command Center.</p>
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title="My conversion" sub={m.convSub} />
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
            <CardHeader title="Weekly activity" sub="Logged touches, last 8 weeks" />
            <CardBody>
              <Columns label="Weekly activity by type, last 8 weeks" data={weeks} xKey="week" height={200}
                series={[{ key: "call", label: "Calls", color: "var(--chart-1)" }, { key: "whatsapp", label: "WhatsApp", color: "var(--chart-3)" }, { key: "email", label: "Email", color: "var(--chart-2)" }, { key: "meeting", label: m.actSeries, color: "var(--chart-4)" }]} />
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-3">
          <Card className="h-full">
            <CardHeader title={m.mixTitle} sub="First touch" />
            <CardBody><Donut label={m.mixAria} data={mix} centerValue={num(mix.reduce((a, x) => a + x.n, 0))} centerLabel={m.mixCenter} size={132} /></CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title={m.stuck} sub={m.stuckSub} />
            <ul className="divide-y divide-line border-t border-line">
              {stuck.slice(0, 5).map((d) => {
                const age = Math.floor((nowMs - new Date(d.stageEnteredAt).getTime()) / DAY);
                return (
                  <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0"><Link href={`/leads/${d.leadId}`} className="block truncate text-[13px] font-medium hover:text-accent">{firmOf(d.accountId)?.name}</Link><span className="text-[12px] text-ink-3">{v.dealStage[d.stage]} · {inrCompact(d.value)}</span></div>
                    <Badge tone={age > 14 ? "danger" : "warn"}><Hourglass />{age}d</Badge>
                  </li>
                );
              })}
              {!stuck.length && <li className="px-5 py-6 text-[13px] text-ink-3">{m.stuckNone}</li>}
            </ul>
          </Card>
        </StaggerItem>
        {hosp && (
          <>
            <StaggerItem className="lg:col-span-6">
              <Card className="h-full">
                <CardHeader title="Replies due today" sub="Open enquiries with a reply or call promised by today" />
                <ul className="divide-y divide-line border-t border-line">
                  {repliesDue.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                      <div className="min-w-0"><Link href={`/leads/${l.id}`} className="block truncate text-[13px] font-medium hover:text-accent">{l.name}</Link><span className="block truncate text-[12px] text-ink-3">{l.nextAction ?? l.title}</span></div>
                      <span className={cn("shrink-0 text-[12px] num", dayKey(l.nextActionAt!) < today ? "font-medium text-danger" : "text-ink-2")}>{dayKey(l.nextActionAt!) < today ? "overdue" : fmtTime(l.nextActionAt!)}</span>
                    </li>
                  ))}
                  {!repliesDue.length && <li className="px-5 py-6 text-[13px] text-ink-3">No replies promised for today.</li>}
                </ul>
              </Card>
            </StaggerItem>
            <StaggerItem className="lg:col-span-6">
              <Card className="h-full">
                <CardHeader title="Quotes awaiting advance" sub="Rooms on hold or advance pending, oldest first" />
                <ul className="divide-y divide-line border-t border-line">
                  {awaiting.map((d) => {
                    const age = Math.floor((nowMs - new Date(d.stageEnteredAt).getTime()) / DAY);
                    return (
                      <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                        <div className="min-w-0"><Link href={`/leads/${d.leadId}`} className="block truncate text-[13px] font-medium hover:text-accent">{firmOf(d.accountId)?.name ?? d.name}</Link><span className="text-[12px] text-ink-3">{v.dealStage[d.stage]} · {inrCompact(d.value)}{d.stay ? ` · arrives ${fmtDate(d.stay.checkIn + "T06:00:00Z")}` : ""}</span></div>
                        <Badge tone={age > 5 ? "warn" : "neutral"}><Hourglass />{age}d</Badge>
                      </li>
                    );
                  })}
                  {!awaiting.length && <li className="px-5 py-6 text-[13px] text-ink-3">No quotes are waiting on an advance.</li>}
                </ul>
              </Card>
            </StaggerItem>
          </>
        )}
      </Stagger>
      <p className="mt-6 flex items-center gap-1.5 text-[11px] text-ink-3"><CalendarDays className="size-3.5" aria-hidden />{m.foot}</p>
    </>
  );
}
