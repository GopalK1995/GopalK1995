import Link from "next/link";
import { PlugZap } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import { getT, pageTitle } from "@/i18n/server";
import { CONSENT_RATE, isDemo } from "@/lib/data/metrics";
import { dayKey, deltaOf, num, numCompact, pct, ratio, secsToHuman } from "@/lib/format";
import { leadsInWindow } from "@/lib/data/lead-window";
import { modeBanner, panelSources, SOURCE_LABEL, type PanelSource } from "./_lib/panel-source";
import { EmptyState } from "@/components/ui/states";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Gate } from "@/components/ui/gate";
import { Kpi } from "@/components/ui/kpi";
import { PageHeader } from "@/components/ui/misc";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { LineTrend } from "@/components/charts/line-trend";
import { HBar } from "@/components/charts/hbar";
import { Donut } from "@/components/charts/donut";
import { Columns } from "@/components/charts/columns";
import { OTHER } from "@/components/charts/kit";
import type { Ga4Channel, Ga4Page } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { vocabFor } from "@/lib/vertical";
import { DAY_MS, ga4Weekly, inBucket, outcomeOf, weekBuckets } from "../campaigns/_lib/marketing";
import { attributionFromTouches, UNKNOWN_TOUCH } from "./_lib/touches";
import { loadTouches } from "./_lib/load-touches";
import { AttributionPanel } from "./_components/attribution";

export const generateMetadata = pageTitle("webAnalytics");
// Four outcomes, each clearly separable: Won = accent, open after the demo = ochre, upcoming = light cobalt, Lost = grey.
const STACK_COLOR = { won: "var(--chart-1)", open: "var(--chart-2)", booked: "var(--seq-2)", lost: OTHER } as const;
const stackKey = (o: string) => (o === "proposal" || o === "done" ? "open" : o);

export default async function Analytics() {
  const { ds, now, active, session } = await pageCtx();
  const dt = await getT("dashboard");
  const v = vocabFor(active.tenant), a = v.an;
  const STACK = (Object.keys(STACK_COLOR) as (keyof typeof STACK_COLOR)[]).map((key) => ({ key, label: a.stack[key], color: STACK_COLOR[key] }));
  const [{ days: ga4All, pages: pagesAll }, leads, acts, integrations] = await Promise.all([ds.ga4(), ds.leads(), ds.activities(), ds.integrations()]);
  const ga = integrations.find((i) => i.id === "ga4");
  const connected = ga?.status === "connected";
  // AUD-102: one data-mode decision per page. GA4 panels show GA4 rows only when GA4 is connected (or in the demo, labelled sample);
  // a real workspace without GA4 gets empty GA4 panels, never a sample series next to a real KPI.
  const src = panelSources({ demo: session.demo, ga4Connected: connected });
  const ga4On = src.ga4 !== "none";
  const ga4 = ga4On ? ga4All : [], pages = ga4On ? pagesAll : [];
  const srcTag = (s: PanelSource, id?: string) => <span className="font-mono text-[10px] text-ink-3">{id ? `${id} · ` : ""}{SOURCE_LABEL[s]}</span>;
  const notConnected = (what: string) => <EmptyState title="GA4 not connected" body={<>{what} comes from GA4. <Link href="/integrations/ga4" className="font-medium text-accent hover:underline">Connect GA4</Link> to see it.</>} />;
  const nowMs = new Date(now).getTime();
  const today = dayKey(now);
  const back = (n: number) => new Date(new Date(today + "T12:00:00Z").getTime() - n * DAY_MS).toISOString().slice(0, 10);
  const win = (from: number, to: number) => ga4.filter((g) => g.date > back(to) && g.date <= back(from));
  const g30 = win(0, 30), gPrev = win(30, 60);
  const sum = (xs: typeof ga4, k: "sessions" | "engagedSessions" | "keyEvents") => xs.reduce((a, g) => a + g[k], 0);
  const er = ratio(sum(g30, "engagedSessions"), sum(g30, "sessions")), erPrev = ratio(sum(gPrev, "engagedSessions"), sum(gPrev, "sessions"));
  const avgSecs = ratio(g30.reduce((a, g) => a + g.avgEngagementSecs * g.sessions, 0), sum(g30, "sessions"));
  const avgPrev = ratio(gPrev.reduce((a, g) => a + g.avgEngagementSecs * g.sessions, 0), sum(gPrev, "sessions"));
  // M23: GA4 key events (form_submit) vs CRM form submits, last 30 days. Paid-social lead forms never hit the site.
  const crmSubmits = leadsInWindow(leads, now, { days: 30 }).filter((l) => l.channel !== "meta" && l.channel !== "linkedin").length;
  const keyEv = sum(g30, "keyEvents");
  const gap = ga4On ? ratio(keyEv - crmSubmits, crmSubmits) : NaN;
  const l90 = leadsInWindow(leads, now, { days: 90 }); // all leads, last 90 IST days (AUD-091)

  const weeksG = ga4Weekly(ga4, now);
  const wSpark = weeksG.map((w) => w.sessions);

  const chTotals = (Object.keys(ga4[0]?.byChannel ?? {}) as Ga4Channel[]).map((ch) => ({ label: ch, value: g30.reduce((a, g) => a + g.byChannel[ch], 0) })).sort((a, b) => b.value - a.value);
  const dev = g30.reduce((a, g) => ({ mobile: a.mobile + g.byDevice.mobile, desktop: a.desktop + g.byDevice.desktop, tablet: a.tablet + g.byDevice.tablet }), { mobile: 0, desktop: 0, tablet: 0 });
  const devRows = [{ key: "mobile", label: "Mobile", n: dev.mobile }, { key: "desktop", label: "Desktop", n: dev.desktop }, { key: "tablet", label: "Tablet", n: dev.tablet }];

  // Demos booked per week, stacked by where each demo stands today.
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const bookedActs = acts.filter((a) => a.kind === "demo_booked" && leadById.has(a.leadId));
  const demoWeeks = weekBuckets(now, 12).map((w) => {
    const row: Record<string, number | string> = { week: w.label };
    for (const o of STACK) row[o.key] = 0;
    bookedActs.filter((a) => inBucket(dayKey(a.at), w)).forEach((a) => { const k = stackKey(outcomeOf(leadById.get(a.leadId)!)); row[k] = Number(row[k]) + 1; });
    return row;
  });
  const demoTotal = bookedActs.filter((a) => nowMs - new Date(a.at).getTime() < 84 * DAY_MS).length;
  const colSeries = STACK.map(({ key, label, color }) => ({ key, label, color }));

  // Attribution reads the touches the CRM recorded. Demo sessions use the sample leads; real sessions read first/last touch from the
  // lead rows and keep a missing touch as its own row instead of crediting Organic.
  let touches: Awaited<ReturnType<typeof loadTouches>> | undefined, touchError = false;
  if (!session.demo) { try { touches = await loadTouches(active.ws.uuid, new Date(nowMs - 90 * DAY_MS).toISOString()); } catch { touchError = true; } }
  const attOpts = { touches, unknownLabel: dt("attUnknown"), isDemo, isWon: (l: (typeof l90)[number]) => l.stage === "won" };
  const first = attributionFromTouches(l90, "first", attOpts), last = attributionFromTouches(l90, "last", attOpts);
  const untouched = first.find((r) => r.ch === UNKNOWN_TOUCH)?.leads ?? 0;

  const pageCols: Column<Ga4Page>[] = [
    { key: "path", header: "Landing page", mobile: "title", cell: (p) => <div className="min-w-0"><div className="truncate font-mono text-[12px] text-ink">{p.path}</div><div className="hidden truncate text-[11px] text-ink-3 md:block">{p.title}</div></div> },
    { key: "s", header: "Sessions", align: "right", mobile: "fact", cell: (p) => <span>{num(p.sessions)}<span className="md:hidden"> sessions</span></span> },
    { key: "er", header: "Engaged", align: "right", cell: (p) => pct(p.engagementRate, 0) },
    { key: "t", header: "Avg time", align: "right", cell: (p) => secsToHuman(p.avgSecs) },
    { key: "c", header: "Key events", align: "right", mobile: "fact", cell: (p) => <span className={cn(p.path === a.ctaPath && "font-medium")}>{p.conversions}<span className="md:hidden"> key events</span></span> },
  ];

  const banner = modeBanner(src, active.tenant.name);
  return (
    <>
      <PageHeader eyebrow="Marketing · website" title="Web analytics"
        sub={a.sub(active.tenant.name)}
        actions={<><Link href="/analytics/social" className="text-[13px] font-medium text-accent hover:underline">{dt("attSocialLink")}</Link><Gate can="connectIntegrations" reason="Only the Owner connects integrations."><Button variant="primary"><PlugZap />Connect GA4</Button></Gate></>} />

      {banner && (
        <div role="note" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed border-ink-3/60 bg-surface px-4 py-3 text-[13px] text-ink-2">
          {src.ga4 === "sample" && <StatusChip status="sample" />}
          <span>{banner}</span>
          <Link href="/integrations/ga4" className="font-medium text-accent hover:underline">{src.ga4 === "sample" ? "See what connecting needs" : "Connect GA4"}</Link>
        </div>
      )}

      <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <StaggerItem className="grid gap-4 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-4">
          <Kpi label="Sessions · 30 days" metric="M20" value={ga4On ? sum(g30, "sessions") : null} spark={wSpark} delta={deltaOf(sum(g30, "sessions"), sum(gPrev, "sessions"))} deltaLabel="" foot={<>vs prior 30 days · {num(Math.round(sum(g30, "sessions") / 30))} a day</>} />
          <Kpi label="Engagement rate" metric="M21" value={er} format="pct" delta={er - erPrev} deltaLabel="" foot={<>points vs prior 30 days · engaged ÷ sessions</>} />
          <Kpi label="Avg engagement time · seconds" metric="M22" value={Number.isFinite(avgSecs) ? Math.round(avgSecs) : null} delta={deltaOf(avgSecs, avgPrev)} deltaLabel="" foot={<>vs prior 30 days · {secsToHuman(avgSecs)} per session</>} />
          <div className={cn("flex min-w-0 flex-col justify-between gap-3 rounded-md border bg-surface p-4 shadow-1", Math.abs(gap) > 0.25 ? "border-warn/50" : "border-line")}>
            <div className="flex items-start justify-between gap-2"><span className="text-[12px] font-medium leading-4 text-ink-2">{a.formsKpi}</span><span className="font-mono text-[10px] text-ink-3">M23</span></div>
            <div>
              <div className="text-[26px] font-semibold leading-8 tracking-[-0.02em] num">{Number.isFinite(gap) ? `${gap > 0 ? "+" : "−"}${Math.abs(gap * 100).toFixed(0)}%` : "No data"}</div>
              <div className="mt-1 text-[12px] text-ink-2 num">{ga4On ? `${keyEv} GA4 key events` : "GA4 not connected"} · {crmSubmits} {a.crmSubmits}</div>
            </div>
            <div className="border-t border-line pt-2 text-[12px] leading-4 text-ink-3">{Math.abs(gap) > 0.25 ? <span className="font-medium text-warn-ink">Above the 25% flag. </span> : "Within the 25% tolerance. "}Consent gating and ad blockers make GA4 and the CRM differ.</div>
          </div>
        </StaggerItem>

        <StaggerItem className="lg:col-span-8">
          <Card className="h-full">
            <CardHeader title="Is site traffic growing?" sub="Sessions and engaged sessions per week, last 12 weeks" action={srcTag(src.ga4, "M20 · M21")} />
            <CardBody>
              {!ga4On ? notConnected("Weekly traffic") : <LineTrend label={`Weekly sessions and engaged sessions. Latest week ${num(weeksG.at(-1)?.sessions ?? 0)} sessions, ${num(weeksG.at(-1)?.engaged ?? 0)} engaged.`} data={weeksG} xKey="week"
                series={[{ key: "sessions", label: "Sessions", color: "var(--chart-1)" }, { key: "engaged", label: "Engaged sessions", color: "var(--chart-3)", dashed: true }]} yFormat="numCompact" height={240} />}
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title="What device are they on?" sub="Sessions, last 30 days" action={srcTag(src.ga4)} />
            <CardBody>{!ga4On ? notConnected("Device split") : <Donut label={`Sessions by device. ${devRows.map((d) => `${d.label} ${d.n}`).join(", ")}`} data={devRows} centerLabel="sessions" centerValue={numCompact(sum(g30, "sessions"))} size={148} />}</CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-5">
          <Card className="h-full">
            <CardHeader title="Where do visitors come from?" sub="GA4 default channel group, sessions in the last 30 days" action={srcTag(src.ga4)} />
            <CardBody>{!ga4On ? notConnected("Traffic by channel") : <HBar label={`Sessions by channel group. ${chTotals.map((c) => `${c.label} ${c.value}`).join(", ")}`} data={chTotals} format="num" highlight={chTotals[0]?.label} labelWidth={112} valueLabel="Sessions" />}</CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title={a.weeklyTitle} sub={a.weeklySub(demoTotal)} action={srcTag(src.crm, "M10")} />
            <CardBody>
              {bookedActs.length === 0 ? <EmptyState title="No demos booked yet" body="No demo-booked activity is recorded in the CRM for this workspace." /> : <><Columns label={`${a.weeklyAria} ${demoWeeks.map((w) => `${w.week}: ${STACK.reduce((a, o) => a + Number(w[o.key]), 0)}`).join(", ")}`} data={demoWeeks} xKey="week" series={colSeries} height={240} />
              <p className="mt-2 text-[11px] text-ink-3">{a.weeklyNote}</p></>}
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title="Top landing pages" sub={a.pagesSub} action={srcTag(src.ga4)} />
            {!ga4On ? <CardBody>{notConnected("Landing pages")}</CardBody> : <DataTable rows={[...pages].sort((a, b) => b.sessions - a.sessions)} columns={pageCols} rowKey={(p) => p.path} minWidth={520} caption="Top landing pages by sessions" />}
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-5">
          <Card className="h-full" id="attribution">
            <CardHeader title={dt("attTitle")} sub={touchError ? dt("partialFailed") + ": " + dt("attSource") : dt("attSub", { n: l90.length, unknown: untouched })} action={srcTag(src.crm)} />
            <CardBody><AttributionPanel first={first} last={last} /></CardBody>
          </Card>
        </StaggerItem>
      </Stagger>
      <p className="mt-6 text-[11px] text-ink-3">{src.ga4 === "sample" && <StatusChip status="sample" className="mr-1.5" />}{src.ga4 === "sample" ? "GA4 sample series. " : ""}Only {pct(CONSENT_RATE, 0)} of visitors accept analytics cookies, so CRM funnels count fewer visitors than GA4.</p>
    </>
  );
}
