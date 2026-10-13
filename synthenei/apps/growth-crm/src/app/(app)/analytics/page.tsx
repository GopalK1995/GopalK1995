import Link from "next/link";
import { PlugZap } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import { CONSENT_RATE } from "@/lib/data/metrics";
import { dayKey, num, numCompact, pct, ratio } from "@/lib/format";
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
import { DAY_MS, attribution, ga4Weekly, inBucket, outcomeOf, weekBuckets } from "../campaigns/_lib/marketing";
import { AttributionPanel } from "./_components/attribution";

export const metadata = { title: "Web analytics" };
// Four outcomes, each clearly separable: Won = accent, open after the demo = ochre, upcoming = light cobalt, Lost = grey.
const STACK = [
  { key: "won", label: "Won", color: "var(--chart-1)" },
  { key: "open", label: "Demo done, deal open", color: "var(--chart-2)" },
  { key: "booked", label: "Booked, upcoming", color: "var(--seq-2)" },
  { key: "lost", label: "Lost", color: OTHER },
];
const stackKey = (o: string) => (o === "proposal" || o === "done" ? "open" : o);

export default async function Analytics() {
  const { ds, now } = await pageCtx();
  const [{ days: ga4, pages }, leads, acts, integrations] = await Promise.all([ds.ga4(), ds.leads(), ds.activities(), ds.integrations()]);
  const ga = integrations.find((i) => i.id === "ga4");
  const connected = ga?.status === "connected";
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
  const crmSubmits = leads.filter((l) => nowMs - new Date(l.createdAt).getTime() < 30 * DAY_MS && l.channel !== "meta" && l.channel !== "linkedin").length;
  const keyEv = sum(g30, "keyEvents");
  const gap = ratio(keyEv - crmSubmits, crmSubmits);
  const l90 = leads.filter((l) => nowMs - new Date(l.createdAt).getTime() < 90 * DAY_MS);
  const untagged = ratio(l90.filter((l) => !l.utm.campaign).length, l90.length);

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

  const first = attribution(l90, "first"), last = attribution(l90, "last");

  const pageCols: Column<Ga4Page>[] = [
    { key: "path", header: "Landing page", mobile: "title", cell: (p) => <div className="min-w-0"><div className="truncate font-mono text-[12px] text-ink">{p.path}</div><div className="hidden truncate text-[11px] text-ink-3 md:block">{p.title}</div></div> },
    { key: "s", header: "Sessions", align: "right", mobile: "fact", cell: (p) => <span>{num(p.sessions)}<span className="md:hidden"> sessions</span></span> },
    { key: "er", header: "Engaged", align: "right", cell: (p) => pct(p.engagementRate, 0) },
    { key: "t", header: "Avg time", align: "right", cell: (p) => `${Math.floor(p.avgSecs / 60)}m ${String(p.avgSecs % 60).padStart(2, "0")}s` },
    { key: "c", header: "Key events", align: "right", mobile: "fact", cell: (p) => <span className={cn(p.path === "/demo" && "font-medium")}>{p.conversions}<span className="md:hidden"> key events</span></span> },
  ];

  return (
    <>
      <PageHeader eyebrow="Marketing · website" title="Web analytics"
        sub="How people move through the LAWSOME site before they become leads, and which channel gets credit once they do."
        actions={<><Gate can="connectIntegrations" reason="Only the Owner connects integrations."><Button variant="primary"><PlugZap />Connect GA4</Button></Gate></>} />

      {!connected && (
        <div role="note" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-dashed border-ink-3/60 bg-surface px-4 py-3 text-[13px] text-ink-2">
          <StatusChip status="showcase" />
          <span>GA4 is not connected. Every number here is a sample series shaped like a GA4 property for the LAWSOME site.</span>
          <Link href="/integrations/ga4" className="font-medium text-accent hover:underline">See what connecting needs</Link>
        </div>
      )}

      <Stagger className="grid gap-4 lg:grid-cols-12">
        <StaggerItem className="grid gap-4 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-4">
          <Kpi label="Sessions · 30 days" metric="M20" value={sum(g30, "sessions")} spark={wSpark} delta={ratio(sum(g30, "sessions"), sum(gPrev, "sessions")) - 1} deltaLabel="" foot={<>vs prior 30 days · {num(Math.round(sum(g30, "sessions") / 30))} a day</>} />
          <Kpi label="Engagement rate" metric="M21" value={er} format="pct" delta={er - erPrev} deltaLabel="" foot={<>points vs prior 30 days · engaged ÷ sessions</>} />
          <Kpi label="Avg engagement time · seconds" metric="M22" value={Math.round(avgSecs)} delta={ratio(avgSecs, avgPrev) - 1} deltaLabel="" foot={<>vs prior 30 days · {Math.floor(avgSecs / 60)}m {String(Math.round(avgSecs % 60)).padStart(2, "0")}s per session</>} />
          <div className={cn("flex min-w-0 flex-col justify-between gap-3 rounded-md border bg-surface p-4 shadow-1", Math.abs(gap) > 0.25 ? "border-warn/50" : "border-line")}>
            <div className="flex items-start justify-between gap-2"><span className="text-[12px] font-medium leading-4 text-ink-2">GA4 vs CRM form submits</span><span className="font-mono text-[10px] text-ink-3">M23</span></div>
            <div>
              <div className="text-[26px] font-semibold leading-8 tracking-[-0.02em] num">{Number.isFinite(gap) ? `${gap > 0 ? "+" : "−"}${Math.abs(gap * 100).toFixed(0)}%` : "–"}</div>
              <div className="mt-1 text-[12px] text-ink-2 num">{keyEv} GA4 key events · {crmSubmits} CRM submits</div>
            </div>
            <div className="border-t border-line pt-2 text-[12px] leading-4 text-ink-3">{Math.abs(gap) > 0.25 ? <span className="font-medium text-warn-ink">Above the 25% flag. </span> : "Within the 25% tolerance. "}Consent gating and ad blockers make GA4 and the CRM differ.</div>
          </div>
        </StaggerItem>

        <StaggerItem className="lg:col-span-8">
          <Card className="h-full">
            <CardHeader title="Is site traffic growing?" sub="Sessions and engaged sessions per week, last 12 weeks" action={<span className="font-mono text-[10px] text-ink-3">M20 · M21</span>} />
            <CardBody>
              <LineTrend label={`Weekly sessions and engaged sessions. Latest week ${num(weeksG.at(-1)?.sessions ?? 0)} sessions, ${num(weeksG.at(-1)?.engaged ?? 0)} engaged.`} data={weeksG} xKey="week"
                series={[{ key: "sessions", label: "Sessions", color: "var(--chart-1)" }, { key: "engaged", label: "Engaged sessions", color: "var(--chart-3)", dashed: true }]} yFormat="numCompact" height={240} />
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title="What device are they on?" sub="Sessions, last 30 days" />
            <CardBody><Donut label={`Sessions by device. ${devRows.map((d) => `${d.label} ${d.n}`).join(", ")}`} data={devRows} centerLabel="sessions" centerValue={numCompact(sum(g30, "sessions"))} size={148} /></CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-5">
          <Card className="h-full">
            <CardHeader title="Where do visitors come from?" sub="GA4 default channel group, sessions in the last 30 days" />
            <CardBody><HBar label={`Sessions by channel group. ${chTotals.map((c) => `${c.label} ${c.value}`).join(", ")}`} data={chTotals} format="num" highlight={chTotals[0]?.label} labelWidth={112} valueLabel="Sessions" /></CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title="How many demos are booked each week, and where are they now?" sub={`${demoTotal} demos booked in 12 weeks, stacked by today's outcome`} action={<span className="font-mono text-[10px] text-ink-3">M10</span>} />
            <CardBody>
              <Columns label={`Demos booked per week stacked by outcome. ${demoWeeks.map((w) => `${w.week}: ${STACK.reduce((a, o) => a + Number(w[o.key]), 0)}`).join(", ")}`} data={demoWeeks} xKey="week" series={colSeries} height={240} />
              <p className="mt-2 text-[11px] text-ink-3">Recent weeks are mostly upcoming or open: outcomes settle 2–4 weeks after the demo.</p>
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title="Top landing pages" sub="Last 90 days. Key event = form submit or demo booking." />
            <DataTable rows={[...pages].sort((a, b) => b.sessions - a.sessions)} columns={pageCols} rowKey={(p) => p.path} minWidth={520} caption="Top landing pages by sessions" />
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-5">
          <Card className="h-full">
            <CardHeader title="Which channel gets the credit?" sub={`Leads from the last 90 days. ${pct(untagged, 0)} arrived without a utm_campaign (M19).`} />
            <CardBody><AttributionPanel first={first} last={last} /></CardBody>
          </Card>
        </StaggerItem>
      </Stagger>
      <p className="mt-6 text-[11px] text-ink-3"><StatusChip status="sample" className="mr-1.5" />GA4 sample series. Only {pct(CONSENT_RATE, 0)} of visitors accept analytics cookies, so CRM funnels count fewer visitors than GA4.</p>
    </>
  );
}
