import Link from "next/link";
import { Ban, CircleCheck, EyeOff, Gauge, Scale, ShieldCheck, UserCheck } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import { accessFor } from "@/lib/auth/roles";
import { campaignStats } from "@/lib/data/metrics";
import { fmtDate, fmtDateTime, inr, inrCompact, num, pct, ratio } from "@/lib/format";
import { Card, CardBody, CardHeader, NavyPanel } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, ScoreChip } from "@/components/ui/misc";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { Columns } from "@/components/charts/columns";
import { verdict } from "../accounts/_components/perms";
import { QUESTIONS, ask } from "./_components/ask-engine";
import { AskBox } from "./_components/ask-box";
import { FeatureCards, type Feature } from "./_components/features";
import { WeightsEditor, type FactorRow } from "./_components/weights";

export const metadata = { title: "Copilot" };
const DAY = 86400e3;

export default async function Copilot() {
  const { ds, now, role, support, session, scope } = await pageCtx();
  const [allLeads, allDeals, allTasks, accounts, team, campaigns, days, convs] = await Promise.all([
    ds.leads(), ds.deals(), ds.tasks(), ds.accounts(), ds.team(), ds.campaigns(), ds.campaignDays(), ds.conversations(),
  ]);
  const leads = scope.leads(allLeads), deals = scope.deals(allDeals), tasks = scope.tasks(allTasks);
  const ctx = { role, support, uid: session.uid };
  const canCampaigns = !!accessFor(role, "/campaigns");
  const canLog = verdict("viewAiLog", ctx).ok;
  const rep = role === "sales_rep";

  // Lead scoring: factor table from stored score_factors (so the number is always explainable).
  const labels = [...new Set(leads.flatMap((l) => l.scoreFactors.map((f) => f.label)))];
  const points = leads.map((l) => labels.map((lb) => l.scoreFactors.find((f) => f.label === lb)?.points ?? 0));
  const factors: FactorRow[] = labels.map((lb, j) => {
    const col = points.map((p) => p[j]); const best = leads.find((l) => l.scoreFactors.some((f) => f.label === lb && f.points !== 0 && Math.abs(f.points) === Math.max(...col.map(Math.abs))));
    return { label: lb, weight: col.reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m), 0), avg: col.reduce((a, b) => a + b, 0) / Math.max(1, col.length), share: ratio(col.filter((x) => x !== 0).length, col.length) || 0, example: best?.scoreFactors.find((f) => f.label === lb)?.detail ?? "" };
  });
  const order = factors.map((_, j) => j).sort((a, b) => Math.abs(factors[b].weight) - Math.abs(factors[a].weight));
  const hot = [...leads].filter((l) => l.stage !== "won" && l.stage !== "lost").sort((a, b) => b.score - a.score)[0];
  const firmOf = (id: string) => accounts.find((a) => a.id === id);

  // M51 calibration: win rate by score band among leads with a closed outcome.
  const bands = [{ k: "0–39", lo: 0, hi: 39 }, { k: "40–69", lo: 40, hi: 69 }, { k: "70–100", lo: 70, hi: 100 }].map((b) => {
    const xs = leads.filter((l) => l.score >= b.lo && l.score <= b.hi && (l.stage === "won" || l.stage === "lost"));
    return { band: b.k, rate: ratio(xs.filter((l) => l.stage === "won").length, xs.length) || 0, n: xs.length };
  });

  // Weekly campaign digest from aggregates only (no personal data).
  const end = days.reduce((m, d) => (d.date > m ? d.date : m), "");
  const endMs = new Date(end + "T12:00:00+05:30").getTime();
  const inWeek = (date: string, w: number) => { const t = (endMs - new Date(date + "T12:00:00+05:30").getTime()) / DAY; return t >= w * 7 && t < (w + 1) * 7; };
  const wk = (w: number) => campaigns.map((c) => {
    const ds_ = days.filter((d) => d.campaignId === c.id && inWeek(d.date, w));
    const ls = allLeads.filter((l) => l.campaignId === c.id && inWeek(l.createdAt.slice(0, 10), w));
    const spend = ds_.reduce((a, d) => a + d.spend, 0), clicks = ds_.reduce((a, d) => a + d.clicks, 0), imp = ds_.reduce((a, d) => a + d.impressions, 0);
    return { c, spend, clicks, ctr: ratio(clicks, imp), leads: ls.length, cpl: ratio(spend, ls.length) };
  });
  const tw = wk(0), lw = wk(1);
  const spendT = tw.reduce((a, x) => a + x.spend, 0), spendL = lw.reduce((a, x) => a + x.spend, 0);
  const leadsT = tw.reduce((a, x) => a + x.leads, 0), leadsL = lw.reduce((a, x) => a + x.leads, 0);
  const bestCpl = tw.filter((x) => x.leads >= 2 && x.spend > 0).sort((a, b) => a.cpl - b.cpl)[0];
  const ctrMoves = tw.map((x) => ({ x, prev: lw.find((y) => y.c.id === x.c.id)! })).filter(({ x, prev }) => Number.isFinite(x.ctr) && Number.isFinite(prev.ctr) && prev.ctr > 0)
    .map((m) => ({ ...m, d: m.x.ctr / m.prev.ctr - 1 })).sort((a, b) => a.d - b.d);
  const drop = ctrMoves[0], rise = ctrMoves[ctrMoves.length - 1];
  const dry = tw.filter((x) => x.spend > 2000 && x.leads === 0);
  const stats90 = campaigns.map((c) => campaignStats(c, days, allLeads, allDeals)).filter((s) => s.demos > 0 && s.spend > 0).sort((a, b) => a.costPerDemo - b.costPerDemo);
  const delta = (a: number, b: number) => (b > 0 ? `${a >= b ? "up" : "down"} ${pct(Math.abs(a / b - 1), 0)}` : "new this week");
  const weekLabel = `${fmtDate(new Date(endMs - 6 * DAY).toISOString())}–${fmtDate(new Date(endMs).toISOString())}`;
  const digest: { text: React.ReactNode; m: string; href: string }[] = [
    { text: <>Spend was <b className="num">{inrCompact(spendT)}</b> ({delta(spendT, spendL)} on the week before) for <b className="num">{leadsT}</b> CRM leads ({delta(leadsT, leadsL)}).</>, m: "M9", href: "/campaigns" },
    ...(bestCpl ? [{ text: <>Cheapest leads came from <b>{bestCpl.c.name.split(" — ")[0]}</b> at <b className="num">{inr(bestCpl.cpl)}</b> per lead ({bestCpl.leads} leads).</>, m: "M9", href: `/campaigns/${bestCpl.c.id}` }] : []),
    ...(drop && drop.d < -0.05 ? [{ text: <>Click-through on <b>{drop.x.c.name.split(" — ")[0]}</b> fell {pct(-drop.d, 0)} ({pct(drop.prev.ctr, 2)} to {pct(drop.x.ctr, 2)}).</>, m: "M7", href: `/campaigns/${drop.x.c.id}` }] : []),
    ...(rise && rise.d > 0.05 ? [{ text: <>Click-through on <b>{rise.x.c.name.split(" — ")[0]}</b> rose {pct(rise.d, 0)} to {pct(rise.x.ctr, 2)}.</>, m: "M7", href: `/campaigns/${rise.x.c.id}` }] : []),
    ...(dry.length ? [{ text: <><b>{dry[0].c.name.split(" — ")[0]}</b> spent <b className="num">{inrCompact(dry[0].spend)}</b> with no CRM lead this week: check the form tagging.</>, m: "M13", href: `/campaigns/${dry[0].c.id}` }] : []),
    ...(stats90[0] ? [{ text: <>Over 90 days, <b>{stats90[0].name.split(" — ")[0]}</b> still books demos cheapest at <b className="num">{inr(stats90[0].costPerDemo)}</b> per demo.</>, m: "M11", href: `/campaigns/${stats90[0].id}` }] : []),
  ].slice(0, 5);

  const features: Feature[] = [
    { key: "scoring", name: "Lead scoring", status: "on", does: "Scores each lead 0–100 from fixed rules and lists the factors behind the number.", sends: "Nothing leaves the CRM (rules run in the database).", where: "Score chips, lead page, Hot leads on My day", lastRun: `Nightly · ${fmtDate(now)}, 02:00`, acceptance: "Not applicable", note: "Rule-based: no model is called." },
    { key: "summary", name: "Lead and conversation summary", status: "showcase", does: "Three lines: situation, interest or objection, and the open question, plus the last promised follow-up.", sends: "First name, role, firm, district, timeline text with phone and email removed.", where: "Lead page, inbox side panel", lastRun: "Never (off)", acceptance: "No data yet" },
    { key: "nba", name: "Next-best action", status: "showcase", does: "One action from a fixed list (call, WhatsApp template, email, demo, proposal, nurture) with the reason and a due date.", sends: "Stage, days in stage, last touches, open tasks, score factors.", where: "My day, lead page", lastRun: "Never (off)", acceptance: "No data yet" },
    { key: "drafts", name: "Reply drafts", status: "showcase", does: "Drafts a WhatsApp or email reply in English or Tamil. A person reads, edits and sends it.", sends: "The thread with phone and email removed, approved templates, tone settings.", where: "Inbox composer", lastRun: `Sample · ${convs.length} drafts in Inbox`, acceptance: "No data yet" },
    { key: "digest", name: "Weekly campaign digest", status: "off", does: "Five lines on last week's campaigns. Every number comes from a metric query, not the model.", sends: "Campaign aggregates only. No personal data.", where: "Campaigns, Monday email (later)", lastRun: "Never (off)", acceptance: "No data yet" },
    { key: "ask", name: "Ask the CRM", status: "showcase", does: "Answers questions by picking an approved metric and filter. Never writes its own query.", sends: "Your question and the metric catalogue.", where: "This page", lastRun: "Sample answers below", acceptance: "Not applicable" },
  ];
  const guard = [
    { I: Gauge, t: "Off by default", d: "Each feature stays off until the Owner ticks the data checks for this workspace." },
    { I: UserCheck, t: "A person approves every output", d: "Nothing is sent, moved or assigned by itself. Every draft is accepted, edited or dismissed." },
    { I: EyeOff, t: "Phone and email are never sent", d: "Notes are redacted for phone, email, Aadhaar-like and PAN patterns before any call." },
    { I: Scale, t: "No legal advice", d: "A draft that answers a legal question is replaced with a hand-off line and flagged." },
    { I: ShieldCheck, t: "Numbers come from metric queries", d: "The model writes words around numbers the CRM passes in, with sources shown." },
    { I: Ban, t: "Monthly cap: 2,000 calls", d: "0 used this month. Showcase outputs are sample text; no model is called." },
  ];
  const log = convs.slice(0, 6).map((c) => {
    const l = allLeads.find((x) => x.id === c.leadId); const lastIn = [...c.messages].reverse().find((m) => m.from === "lead");
    return { at: lastIn?.at ?? c.lastAt, feature: "Reply draft", object: `${c.id} · ${l?.name ?? ""}`, for: team.find((t) => t.id === l?.ownerId)?.name ?? "—", outcome: c.aiDraft.needsReview ? "Held: needs Owner review" : "Shown, awaiting review", basedOn: c.aiDraft.basedOn };
  });
  const initial = ask("", "demos_week", { role, uid: session.uid, now, leads, deals, tasks, accounts, team, campaigns, days });

  return (
    <>
      <PageHeader eyebrow="Assist" title="Copilot"
        sub={`What each assistive feature does, what data it sends, and who approves its output. ${rep ? "Answers use your own leads, deals and tasks." : "Features are off until the Owner turns them on."}`} />
      <Stagger className="grid gap-4 lg:grid-cols-12">
        <StaggerItem className="lg:col-span-8">
          <Card className="h-full">
            <CardHeader title="Ask the CRM" sub="Questions map to approved metrics only. Each answer shows the metric ID, filters and source tables." action={<Badge tone="showcase">Showcase</Badge>} />
            <CardBody><AskBox questions={QUESTIONS} initial={initial} /></CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <NavyPanel className="h-full p-5">
            <h2 className="text-[14px] font-semibold">Guardrails for this workspace</h2>
            <p className="mt-0.5 text-[12px] text-navy-ink-3">Apply to every feature on this page (spec section 9).</p>
            <ul className="mt-4 space-y-3.5">
              {guard.map(({ I, t, d }) => (
                <li key={t} className="flex gap-3">
                  <I className="mt-0.5 size-4 shrink-0 text-accent-on-navy" aria-hidden />
                  <div><div className="text-[13px] font-medium">{t}</div><div className="text-[12px] leading-4 text-navy-ink-2">{d}</div></div>
                </li>
              ))}
            </ul>
          </NavyPanel>
        </StaggerItem>

        <StaggerItem className="lg:col-span-12">
          <Card>
            <CardHeader title="Features" sub={verdict("aiToggle", ctx).ok ? "Turning a feature on asks for three data checks first." : "Only the Owner can turn features on or off."} />
            <CardBody><FeatureCards features={features} toggle={verdict("aiToggle", ctx)} /></CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-12">
          <Card>
            <CardHeader title="How the lead score is built" sub={`${leads.length} ${rep ? "of your " : ""}leads · rule-based factors with points, stored with each lead so the number can always be explained`} action={<span className="font-mono text-[10px] text-ink-3">M32 · M51</span>} />
            <CardBody className="space-y-6">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
                {hot ? (
                  <div className="rounded-md border border-line bg-paper/60 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="text-ink-3">Example:</span><Link href={`/leads/${hot.id}`} className="font-medium hover:text-accent">{hot.name}</Link>
                      <span className="text-ink-3">· {firmOf(hot.accountId)?.name}</span><ScoreChip score={hot.score} />
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {[...hot.scoreFactors].sort((a, b) => b.points - a.points).map((f) => (
                        <li key={f.label} className="grid grid-cols-[112px_1fr_36px] items-center gap-3 text-[12px] sm:grid-cols-[168px_1fr_40px]">
                          <span className="text-ink-2">{f.label}</span>
                          <span className="min-w-0"><span className="block h-2 rounded-full bg-paper-2"><span className={`block h-full rounded-full ${f.points < 0 ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.min(100, (Math.abs(f.points) / 30) * 100)}%` }} /></span><span className="mt-0.5 block truncate text-[11px] text-ink-3">{f.detail}</span></span>
                          <span className="text-right font-semibold num">{f.points > 0 ? "+" : ""}{f.points}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : <div className="rounded-md border border-dashed border-line-strong p-6 text-center text-[13px] text-ink-3">No open leads to explain yet. Scores appear once a lead is created.</div>}
                <div className="rounded-md border border-line p-4">
                  <h3 className="text-[13px] font-semibold text-ink">Do high scores actually win?</h3>
                  <p className="text-[12px] text-ink-3">Win rate (%) by score band, leads with a closed outcome</p>
                  <div className="mt-3"><Columns data={bands.map((b) => ({ band: b.band, rate: Math.round(b.rate * 100) }))} series={[{ key: "rate", label: "Win rate %", color: "var(--chart-1)" }]} xKey="band" label="Win rate by score band, percent" format="num" height={180} /></div>
                  <ul className="mt-2 space-y-1 text-[12px]">
                    {bands.map((b) => <li key={b.band} className="flex justify-between"><span className="text-ink-2">Score {b.band}</span><span className="num text-ink-3">n = {b.n}{b.n < 30 && <Badge tone="warn" className="ml-1.5">low n</Badge>}</span></li>)}
                  </ul>
                  <p className="mt-2 text-[11px] text-ink-3">Needs 30+ closed leads per band before weights are trusted.</p>
                </div>
              </div>
              <WeightsEditor factors={order.map((j) => factors[j])} points={points.map((p) => order.map((j) => p[j]))} scores={leads.map((l) => l.score)} edit={verdict("editScoreWeights", ctx)} />
            </CardBody>
          </Card>
        </StaggerItem>

        {canCampaigns && (
          <StaggerItem className={canLog ? "lg:col-span-6" : "lg:col-span-12"}>
            <Card className="h-full">
              <CardHeader title="Weekly campaign digest" sub={`Week of ${weekLabel} · from campaign aggregates only`} action={<Badge tone="accent">AI draft</Badge>} />
              <CardBody>
                <ol className="space-y-2.5">
                  {digest.map((b, i) => (
                    <li key={i} className="flex gap-3 text-[13px] leading-5 text-ink">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-paper-2 text-[11px] font-semibold text-ink-2 num">{i + 1}</span>
                      <span className="min-w-0 flex-1 [&_b]:font-semibold">{b.text} <Link href={b.href} className="font-mono text-[10px] text-accent hover:underline">{b.m}</Link></span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 border-t border-line pt-2 text-[11px] text-ink-3">Based on: campaign_daily_metrics and CRM lead counts for {campaigns.length} campaigns, {weekLabel} vs the week before. Numbers are computed by the CRM; no personal data was used.</p>
              </CardBody>
            </Card>
          </StaggerItem>
        )}
        {canLog && (
          <StaggerItem className={canCampaigns ? "lg:col-span-6" : "lg:col-span-12"}>
            <Card className="h-full">
              <CardHeader title="Activity log" sub="Who generated what, and what happened to it" action={<span className="font-mono text-[10px] text-ink-3">ai_insights</span>} />
              <ul className="divide-y divide-line border-t border-line">
                {log.map((r) => (
                  <li key={r.object} className="px-4 py-2.5 sm:px-5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <span className="min-w-0 truncate"><span className="font-medium">{r.feature}</span> <span className="text-ink-3">· {r.object}</span></span>
                      <Badge tone={r.outcome.startsWith("Held") ? "warn" : "neutral"}>{r.outcome}</Badge>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-ink-3 num">{fmtDateTime(r.at)} · for {r.for} · {r.basedOn}</div>
                  </li>
                ))}
              </ul>
              <p className="flex items-center gap-1.5 px-4 py-2.5 text-[12px] text-ink-3 sm:px-5"><CircleCheck className="size-3.5" aria-hidden />Acceptance rate (M52) starts once a draft is accepted, edited or dismissed: {num(0)} so far.</p>
            </Card>
          </StaggerItem>
        )}
      </Stagger>
    </>
  );
}
