// Home (T054). One organising idea: the month as a ruler, pipeline flow against target, decision zone first.
// Real sessions read their own workspace only; demo sessions read the labelled sample dataset. A reading that cannot be
// computed shows "No data", never 0. Viewers get the same page with names and record links removed.
import Link from "next/link";
import { getT, pageTitle } from "@/i18n/server";
import { loadPrincipal } from "@/lib/authz/load";
import { can } from "@/lib/authz";
import { loadSocialView } from "@/lib/connectors/meta/organic/read";
import type { SocialView } from "@/lib/connectors/meta/organic/view";
import { pageCtx } from "@/lib/data/context";
import { channelMix, isDemo } from "@/lib/data/metrics";
import type { Account, Campaign, CampaignDay, Deal, Lead, Task, TeamMember } from "@/lib/data/types";
import { TILE_CATALOGUE } from "@/lib/config/types";
import { getFormatters } from "@/i18n/formatters";
import { vocabFor } from "@/lib/vertical";
import { PageHeader } from "@/components/ui/misc";
import { StatusChip } from "@/components/ui/badge";
import { KpiLedger } from "@/components/ui/kpi";
import { PartialState } from "@/components/ui/states";
import { ErrorState } from "@/components/ui/states";
import { DecisionZone, PaidOrganicTable, StageFlow } from "./analytics/_components/home-sections";
import { CostChart, FunnelChart, MixChart, PairedChart, PerDayChart, RulerChart } from "./analytics/_components/home-charts";
import { leadsInWindow } from "@/lib/data/lead-window";
import { costPerConverted, decisions, leadFunnel, leadsPerDay, monthRuler, paidVsOrganic, stageFlow, teamVsTarget, tiles, topAccounts, type StageMap } from "./analytics/_lib/home";

export const generateMetadata = pageTitle("home");
export const dynamic = "force-dynamic";

const section = "border-t border-line pt-5";
const h2 = "text-[15px] font-bold tracking-[-0.015em] text-ink";
const sub = "mt-0.5 text-[12px] leading-4 text-ink-3";

export default async function Home() {
  const [t, ctx, principal, f] = await Promise.all([getT("dashboard"), pageCtx(), loadPrincipal(), getFormatters()]);
  const { inr, number: num, percent: pct, dateShort: fmtDate, weekday: fmtWeekday } = f;
  const { ds, now, masked, active, cfg, scope, session } = ctx;
  const failed: string[] = [];
  const optional = async <X,>(source: string, fn: () => Promise<X>, fallback: X): Promise<X> => { try { return await fn(); } catch { failed.push(source); return fallback; } };

  let leads: Lead[], deals: Deal[];
  try { [leads, deals] = await Promise.all([ds.leads(), ds.deals()]); } catch {
    return <><PageHeader title={t("title")} sub={t("sub")} /><ErrorState source={`${active.ws.name}: leads and deals`} message={t("errorMessage")} /></>;
  }
  const [tasks, campaigns, days, team, accounts] = await Promise.all([
    optional<Task[]>("Tasks", () => ds.tasks(), []), optional<Campaign[]>("Campaigns", () => ds.campaigns(), []),
    optional<CampaignDay[]>("Campaign metrics", () => ds.campaignDays(), []), optional<TeamMember[]>("Team and targets", () => ds.team(), []),
    optional<Account[]>("Accounts", () => ds.accounts(), []),
  ]);
  const canAnalytics = can(principal, "analytics.read");
  const social: SocialView | null = canAnalytics ? await loadSocialView() : null;
  if (social?.state === "error") failed.push(social.errorSource ?? t("pvoSource"));

  leads = scope.leads(leads); deals = scope.deals(deals);
  const myTasks = scope.tasks(tasks);
  const stages = cfg.stages.deal as StageMap, leadStages = cfg.stages.lead as StageMap;
  const converted = (l: Lead) => leadStages[l.stage]?.outcome === "won" || isDemo(l);
  const slaHours = cfg.data.slaHours;
  const reps = team.filter((m) => m.role === "sales_rep").filter((m) => ctx.role !== "sales_rep" || m.id === session.uid);
  const fromTeam = reps.reduce((a, m) => a + (m.monthlyTarget > 0 ? m.monthlyTarget : 0), 0);
  const target = fromTeam > 0 ? fromTeam : cfg.data.targetPerRepMonthly && reps.length ? cfg.data.targetPerRepMonthly * reps.length : null;

  const ruler = monthRuler(deals, stages, now, target);
  const flow = stageFlow(deals, stages, now);
  const todo = decisions({ leads, deals, tasks: myTasks, stages, now, slaHours });
  const rooms = vocabFor(active.tenant).rooms || null;
  const ids = cfg.dashboard.kpiTiles;
  const tileLabel = (id: string) => TILE_CATALOGUE.find((x) => x.id === id)?.label ?? id;
  const ledger = tiles(ids, { leads, deals, days, stages, now, slaHours, converted, rooms }).map((x) => ({ ...x, label: tileLabel(x.id), deltaLabel: t("vsPrev") }));
  const pvo = social ? paidVsOrganic({ campaigns, days, leads, social, now }) : null;

  const month = f.monthYear(ruler.month + "-01T12:00:00Z");
  const tableLabels = { chart: t("chart"), table: t("table"), toggle: t("showAs"), noData: t("noData") };
  const canSettings = can(principal, "settings.read");
  const l90 = leadsInWindow(leads, now, { days: 90 }); // all leads, last 90 IST days (AUD-091)
  const chartIds = cfg.dashboard.charts;
  const funnelSteps = leadFunnel(l90, leadStages, t("funnelFirst"));
  const mix = channelMix(l90, 4, cfg.taxonomies.channelFamily);
  const cpc = costPerConverted(campaigns, days, leads, converted);
  const accNames = new Map(accounts.map((a) => [a.id, a.name]));
  const accRows = topAccounts(deals, stages, accNames).map((r, i) => ({ ...r, name: masked || !r.name ? t("account", { n: i + 1 }) : r.name }));
  const teamRows = teamVsTarget(team, deals, stages, now).map((r, i) => ({ ...r, name: masked ? t("rep", { n: i + 1 }) : r.name }));

  const orgNote = pvo && ({
    not_connected: [t("orgNotConnected"), "/integrations/meta-ads", t("orgConnect")], needs_vendor_approval: [t("orgApproval"), "/analytics/social", t("pvoOpen")],
    needs_attention: [t("orgAttention"), "/integrations/meta-ads", t("orgConnect")], empty: [t("orgEmpty"), null, null], error: [t("orgError"), null, null],
    permission_denied: [t("orgDenied"), null, null], ready: null,
  } as Record<SocialView["state"], [string, string | null, string | null] | null>)[pvo.organicState];

  return (
    <>
      <PageHeader eyebrow={t("eyebrow", { weekday: fmtWeekday(now), date: fmtDate(now) })} title={t("title")} sub={t("sub")} />
      <div className="grid gap-6">
        {session.demo && <div role="note" className="flex flex-wrap items-center gap-3 rounded-control border border-dashed border-ink-3/60 bg-surface px-4 py-3 text-[13px] text-ink-2"><StatusChip status="sample" /><span>{t("sampleBand")}</span></div>}
        {failed.length > 0 && <PartialState done={Math.max(0, 6 - failed.length)} total={6} noun={t("partialNoun")} items={failed.map((f) => ({ label: f, status: "failed" as const, detail: t("partialFailed") }))} />}

        <DecisionZone t={t} ruler={ruler} items={todo} slaHours={slaHours} links={!masked} settingsHref={canSettings ? "/settings" : null} />

        <KpiLedger label={t("tilesAria")} noData={t("noData")} tiles={ledger} />

        <section aria-labelledby="ruler-title" className="grid gap-x-8 gap-y-6 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8">
            <h2 id="ruler-title" className={h2}>{t("rulerTitle", { month })}</h2>
            <p className={sub}>{t("rulerSub")}</p>
            <div className="mt-3">
              <RulerChart points={ruler.points} today={ruler.today} tableLabels={tableLabels} caption={t("rulerCaption")} dayHeader={t("colDay")}
                aria={t("rulerAria", { month, won: inr(ruler.won), forecast: inr(ruler.forecastEnd), target: ruler.target === null ? t("noData") : inr(ruler.target) })}
                labels={{ actual: t("seriesWon"), pace: t("seriesPace"), forecast: t("seriesForecast"), today: t("today"), noData: t("noData"), day: t("day") }} />
            </div>
          </div>
          <div className="min-w-0 lg:col-span-4">
            <h2 className={h2}>{t("flowTitle")}</h2>
            <p className={sub}>{t("flowSub")}</p>
            <div className="mt-3"><StageFlow t={t} stages={flow} /></div>
          </div>
        </section>

        {pvo && (
          <section aria-labelledby="pvo-title" className={section}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 id="pvo-title" className={h2}>{t("pvoTitle")}</h2><p className={sub}>{t("pvoSub")}</p></div>
              <Link href="/analytics/social" className="text-[12px] font-medium text-accent hover:underline">{t("pvoOpen")}</Link>
            </div>
            {(orgNote || !pvo.paidConnected) && (
              <ul className="mt-3 space-y-1 text-[13px] text-ink-2">
                {!pvo.paidConnected && <li>{t("paidNone")}</li>}
                {orgNote && <li>{orgNote[0]}{orgNote[1] && <> <Link href={orgNote[1]} className="font-medium text-accent hover:underline">{orgNote[2]}</Link></>}</li>}
              </ul>
            )}
            <div className="mt-3 grid gap-x-8 gap-y-6 lg:grid-cols-12">
              <div className="min-w-0 lg:col-span-5"><PaidOrganicTable t={t} data={pvo} /></div>
              <div className="min-w-0 lg:col-span-7">
                <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("pvoWeeklyTitle")}</h3>
                <PairedChart data={pvo.weekly} aLabel={t("paid")} bLabel={t("organic")} aria={t("pvoWeeklyAria")} caption={t("pvoWeeklyCaption")} weekHeader={t("colWeek")} tableLabels={tableLabels} />
              </div>
            </div>
          </section>
        )}

        {chartIds.length > 0 && (
          <section aria-labelledby="charts-title" className={section}>
            <h2 id="charts-title" className="sr-only">{t("chartsTitle")}</h2>
            <div className="grid gap-x-8 gap-y-8 lg:grid-cols-12">
              {chartIds.map((id) => {
                const wide = id === "perDay";
                const head = (title: string, s: string) => <><h3 className={h2}>{title}</h3><p className={sub}>{s}</p></>;
                return (
                  <div key={id} data-chart={id} className={wide ? "min-w-0 lg:col-span-12" : "min-w-0 lg:col-span-6"}>
                    {id === "perDay" && <>{head(t("perDayTitle"), t("perDaySub"))}<div className="mt-3"><PerDayChart data={leadsPerDay(leads, now, 60)} aria={t("perDayAria")} caption={t("perDayTitle")} labels={{ bar: t("perDayBar"), avg: t("perDayAvg") }} dateHeader={t("colDate")} tableLabels={tableLabels} /></div></>}
                    {id === "mix" && <>{head(t("mixTitle"), t("mixSub"))}<div className="mt-3">{mix.length ? <MixChart data={mix} aria={t("mixAria")} caption={t("mixTitle")} center={{ value: num(l90.length), label: t("mixCenter") }} header={t("mixTitle")} countHeader={t("colCount")} tableLabels={tableLabels} /> : <p className="text-[13px] text-ink-3">{t("noData")}</p>}</div></>}
                    {id === "funnel" && <>{head(t("funnelTitle"), t("funnelSub"))}<div className="mt-3">{funnelSteps[0].n ? <FunnelChart steps={funnelSteps} caption={t("funnelCaption")} headers={{ step: t("colStep"), count: t("colCount"), rate: t("colStepRate") }} tableLabels={tableLabels} /> : <p className="text-[13px] text-ink-3">{t("noData")}</p>}</div></>}
                    {id === "cpd" && <>{head(t("cpdTitle"), t("cpdSub"))}<div className="mt-3">{cpc.length ? <CostChart data={cpc} aria={t("cpdAria")} caption={t("cpdTitle")} headers={{ campaign: t("colCampaign"), cost: t("colCost") }} valueLabel={t("cpdValue")} tableLabels={tableLabels} /> : <p className="text-[13px] text-ink-3">{t("cpdEmpty")}</p>}</div></>}
                    {id === "accounts" && <>{head(t("accountsTitle"), t("accountsSub"))}<div className="mt-3">{accRows.length ? (
                      <table className="w-full border-collapse text-[12px]"><caption className="sr-only">{t("accountsTitle")}</caption>
                        <thead><tr className="border-b border-line text-ink-3"><th scope="col" className="h-8 text-left font-medium">{t("colAccount")}</th><th scope="col" className="h-8 text-right font-medium">{t("colDeals")}</th><th scope="col" className="h-8 text-right font-medium">{t("colOpen")}</th></tr></thead>
                        <tbody>{accRows.map((r) => <tr key={r.id} className="h-9 border-b border-line last:border-0"><th scope="row" className="text-left font-normal text-ink">{r.name}</th><td className="num-mono text-right">{r.deals}</td><td className="num-mono text-right">{inr(r.value)}</td></tr>)}</tbody></table>
                    ) : <p className="text-[13px] text-ink-3">{t("accountsEmpty")}</p>}</div></>}
                    {id === "team" && <>{head(t("teamTitle"), t("teamSub"))}<div className="mt-3">{teamRows.length ? (
                      <table className="w-full border-collapse text-[12px]"><caption className="sr-only">{t("teamTitle")}</caption>
                        <thead><tr className="border-b border-line text-ink-3"><th scope="col" className="h-8 text-left font-medium">{t("colRep")}</th><th scope="col" className="h-8 text-right font-medium">{t("colWon")}</th><th scope="col" className="h-8 text-right font-medium">{t("colTarget")}</th></tr></thead>
                        <tbody>{teamRows.map((r) => <tr key={r.id} className="h-9 border-b border-line last:border-0"><th scope="row" className="text-left font-normal text-ink">{r.name}</th><td className="num-mono text-right">{inr(r.won)}</td><td className="num-mono text-right">{r.target === null ? <span className="text-ink-3">{t("noData")}</span> : <>{inr(r.target)} <span className="text-ink-3">{pct(r.won / r.target, 0)}</span></>}</td></tr>)}</tbody></table>
                    ) : <p className="text-[13px] text-ink-3">{t("teamEmpty")}</p>}</div></>}
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
