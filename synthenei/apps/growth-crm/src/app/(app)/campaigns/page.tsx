import Link from "next/link";
import { pageCtx } from "@/lib/data/context";
import { CHANNEL_LABEL } from "@/lib/data/metrics";
import { dayKey, fmtDate, fmtDateTime, inr, inrCompact, num, numCompact, pct, ratio } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusChip } from "@/components/ui/badge";
import { Kpi } from "@/components/ui/kpi";
import { PageHeader } from "@/components/ui/misc";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { ChannelMark } from "@/components/ui/domain";
import { HBar } from "@/components/charts/hbar";
import { Donut } from "@/components/charts/donut";
import { cn } from "@/lib/utils";
import type { CampaignStats } from "@/lib/data/metrics";
import { CAMPAIGN_CHANNELS, CHANNEL_CHIP, allStats, kpiSeries, radarScores, shortName, sourceState } from "./_lib/marketing";
import { RadarPicker, type RadarCampaign } from "./_components/radar-compare";
import { ImportCsvDialog, NewCampaignDialog } from "./_components/dialogs";

export const metadata = { title: "Campaigns" };
const STATUS_TONE = { live: "success", paused: "warn", ended: "neutral" } as const;
const STATUS_LABEL = { live: "Live", paused: "Paused", ended: "Ended" } as const;
const money = (n: number) => (Number.isFinite(n) ? inr(n) : "–");

export default async function Campaigns() {
  const { ds, now } = await pageCtx();
  const [campaigns, days, leads, deals, integrations, syncRuns, accounts, acts] = await Promise.all([
    ds.campaigns(), ds.campaignDays(), ds.leads(), ds.deals(), ds.integrations(), ds.syncRuns(), ds.accounts(), ds.activities(),
  ]);
  const stats = allStats(campaigns, days, leads, deals);
  const src = sourceState(integrations);
  const k = kpiSeries(days, leads, acts, now);
  const tot = stats.reduce((a, s) => ({ spend: a.spend + s.spend, leads: a.leads + s.leads, demos: a.demos + s.demos }), { spend: 0, leads: 0, demos: 0 });
  const ranked = [...stats].sort((a, b) => b.leads - a.leads);

  // CPL comparison (hbar, cheapest first). Email has tool cost only, so it is labelled rather than hidden.
  // Mailchimp carries tool cost only (no media spend); it is included and marked, not hidden.
  const cplRows = stats.filter((s) => s.leads > 0 && s.spend > 0).map((s) => ({ label: s.channel === "email" ? `${shortName(s.name)} *` : shortName(s.name), value: Math.round(s.cpl), note: `${s.leads} leads · ${CHANNEL_LABEL[s.channel]}${s.channel === "email" ? " · tool cost only" : ""}` })).sort((a, b) => a.value - b.value);
  const best = [...stats].filter((s) => s.demos >= 3 && s.spend > 0 && s.channel !== "email").sort((a, b) => a.costPerDemo - b.costPerDemo)[0];
  const email = stats.find((s) => s.channel === "email" && s.demos > 0);

  // Spend share by channel (5 campaign channels = 5 slices, no fold needed).
  const byCh = CAMPAIGN_CHANNELS.map((ch) => {
    const xs = stats.filter((s) => s.channel === ch);
    const spend = xs.reduce((a, s) => a + s.spend, 0), l = xs.reduce((a, s) => a + s.leads, 0), d = xs.reduce((a, s) => a + s.demos, 0);
    return { ch, spend, leads: l, demos: d, n: xs.length, live: xs.filter((s) => s.status === "live").length, cpl: ratio(spend, l), cpd: ratio(spend, d) };
  }).filter((c) => c.n > 0).sort((a, b) => b.spend - a.spend);
  // Top 3 + Other keeps the donut to 4 slices; the list under it carries every channel.
  const donut = [...byCh.slice(0, 3).map((c) => ({ key: c.ch as string, label: CHANNEL_CHIP[c.ch], n: c.spend })), ...(byCh.length > 3 ? [{ key: "other", label: `Other (${byCh.slice(3).map((c) => CHANNEL_CHIP[c.ch]).join(", ")})`, n: byCh.slice(3).reduce((a, c) => a + c.spend, 0) }] : [])];

  // Radar: scores + the raw value behind each score.
  const scores = radarScores(stats);
  const radarCampaigns: RadarCampaign[] = ranked.map((s) => ({
    id: s.id, label: shortName(s.name), scores: scores.get(s.id)!,
    raw: [numCompact(s.reach), pct(s.engagementRate, 1), pct(s.ctr, 2), pct(s.leadRate, 1), s.spend === 0 ? "no spend" : `${inrCompact(s.cpl)} CPL`],
  }));

  // Radar default: the three campaigns with the fullest profile (mean score), one per channel, so shapes are readable.
  const meanScore = (id: string) => scores.get(id)!.reduce((a, v) => a + v, 0) / 5;
  const radarInit = [...stats].sort((a, b) => meanScore(b.id) - meanScore(a.id)).filter((s, i, xs) => xs.findIndex((x) => x.channel === s.channel) === i).slice(0, 3).map((s) => s.id);
  // Import stats from the sync log (CSV bridge is the live inbound path in MVP).
  const nowMs = new Date(now).getTime();
  const imports = CAMPAIGN_CHANNELS.map((ch) => {
    const runs = syncRuns.filter((r) => r.integrationId === src[ch].id).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const week = runs.filter((r) => nowMs - new Date(r.startedAt).getTime() < 7 * 86400e3);
    return { ch, ...src[ch], last: runs[0], rows: week.reduce((a, r) => a + r.rowsIn, 0), rejected: week.reduce((a, r) => a + r.rowsRejected, 0), failed: week.filter((r) => r.status === "failed").length };
  });
  const districts = [...new Set(accounts.map((a) => a.district))].sort();
  const yyyymm = dayKey(now).slice(0, 7).replace("-", "");

  const cols: Column<CampaignStats>[] = [
    { key: "name", header: "Campaign", mobile: "title", className: "max-w-[300px]", cell: (s) => (
      <div className="min-w-0">
        <Link href={`/campaigns/${s.id}`} className="block truncate font-medium text-ink hover:text-accent">{s.name}</Link>
        <span className="hidden font-mono text-[11px] text-ink-3 md:inline">{s.utmCampaign} · from {fmtDate(s.startDate + "T06:00:00Z")}</span>
      </div>
    ) },
    { key: "ch", header: "Channel", cell: (s) => <ChannelMark channel={s.channel} withLabel /> },
    { key: "status", header: "Status", cell: (s) => <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge> },
    { key: "spend", header: "Spend", align: "right", mobile: "fact", cell: (s) => <span><span className="md:hidden">{CHANNEL_CHIP[s.channel]} · </span>{inr(s.spend)}</span> },
    { key: "reach", header: "Reach", align: "right", cell: (s) => numCompact(s.reach) },
    { key: "ctr", header: <span title="Clicks / impressions. WhatsApp and email: clicks / delivered.">CTR<sup className="ml-0.5 text-ink-3">†</sup></span>, align: "right", cell: (s) => pct(s.ctr, 2) },
    { key: "cpl", header: "CPL", align: "right", cell: (s) => (s.spend === 0 ? <span className="text-ink-3" title="Tool cost only">₹0</span> : money(s.cpl)) },
    { key: "leads", header: "Leads", align: "right", mobile: "fact", className: "font-medium", cell: (s) => <span>{s.leads}<span className="md:hidden"> leads · {s.demos} demos</span></span> },
    { key: "demos", header: "Demos", align: "right", cell: (s) => s.demos },
    { key: "conv", header: "Lead → demo", align: "right", cell: (s) => <span className={cn(s.leads < 20 && "text-ink-2")}>{pct(s.leadToDemo, 0)}{s.leads < 20 && <span className="ml-1 text-[10px] text-ink-3">low n</span>}</span> },
    { key: "gap", header: <span title="Platform leads minus CRM leads (M13)">Gap</span>, align: "right", cell: (s) => <span className={cn(s.gap !== 0 && "text-warn-ink")} title="Platform-reported leads minus leads found in the CRM">{s.gap > 0 ? `+${s.gap}` : s.gap}</span> },
    { key: "open", header: <span className="sr-only">Open</span>, mobile: "action", className: "md:hidden", cell: (s) => <Link href={`/campaigns/${s.id}`} className="font-medium text-accent">Open</Link> },
  ];

  return (
    <>
      <PageHeader eyebrow="Marketing · last 90 days" title="Campaigns"
        sub="Which campaigns turn rupees into demos. Spend and reach come from platform exports; leads and demos are counted in the CRM, so the Gap column shows where they disagree."
        actions={<><ImportCsvDialog campaigns={campaigns.map((c) => ({ id: c.id, name: c.name, channel: c.channel }))} /><NewCampaignDialog districts={districts} yyyymm={yyyymm} /></>} />

      <Stagger className="grid gap-4 lg:grid-cols-12">
        <StaggerItem className="grid gap-4 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-5">
          <Kpi label="Spend · 30 days" metric="M8" value={k.cur.spend} format="inrCompact" spark={k.spendW} foot={<>{Number.isFinite(k.d.spend) ? `${k.d.spend >= 0 ? "+" : "−"}${Math.abs(k.d.spend * 100).toFixed(1)}% vs prior 30d` : "no prior period"} · {inrCompact(tot.spend)} in 90d</>} />
          <Kpi label="Leads · 30 days" metric="M9" value={k.cur.leads} spark={k.leadsW} delta={k.d.leads} deltaLabel="" foot={<>vs prior 30d · {tot.leads} in 90d</>} />
          <Kpi label="Cost per lead · 30 days" metric="M9" value={k.cur.cpl} format="inr" spark={k.cplW} delta={k.d.cpl} deltaLabel="" goodWhen="down" foot={<>vs prior 30d · first touch</>} />
          <Kpi label="Demos booked · 30 days" metric="M10" value={k.cur.demos} spark={k.demosW} delta={k.d.demos} deltaLabel="" foot={<>vs prior 30d · by booking date</>} />
          <Kpi label="Cost per demo · 30 days" metric="M11" value={k.cur.cpd} format="inr" spark={k.cpdW} delta={k.d.cpd} deltaLabel="" goodWhen="down" className="sm:col-span-2 lg:col-span-1" foot={<>vs prior 30d · {inrCompact(ratio(tot.spend, tot.demos))} over 90d</>} />
        </StaggerItem>

        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title="Which campaigns bring leads cheapest?" sub="Cost per CRM lead over 90 days, lowest first. * Mailchimp counts tool cost only, no media spend." action={<span className="font-mono text-[10px] text-ink-3">M9</span>} />
            <CardBody>
              <HBar label={`Cost per lead by campaign, lowest first. ${cplRows.map((r) => `${r.label} ${inr(r.value)}`).join(", ")}`} data={cplRows} format="inr" highlight={cplRows[0]?.label} labelWidth={176} valueLabel="Cost per lead" />
              {best && <p className="mt-3 rounded-sm bg-accent-soft px-3 py-2 text-[12px] leading-5 text-ink-2"><Link href={`/campaigns/${best.id}`} className="font-medium text-ink hover:text-accent">{best.name}</Link> books demos at {inr(best.costPerDemo)} each, the lowest of any paid-media campaign with 3 or more demos.{email && <> Email re-engagement ({shortName(email.name)}) costs {inr(email.costPerDemo)} per demo, but only reaches people already in the list.</>}</p>}
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-5">
          <Card className="h-full">
            <CardHeader title="Where did the spend go?" sub="Share of 90-day spend by channel" />
            <CardBody>
              <Donut label={`Spend share by channel. ${donut.map((d) => `${d.label} ${inrCompact(d.n)}`).join(", ")}`} data={donut} format="inrCompact" centerLabel="total spend" centerValue={inrCompact(tot.spend)} size={152} />
              <ul className="mt-4 space-y-1.5 border-t border-line pt-3 text-[12px]">
                {byCh.map((c) => (
                  <li key={c.ch} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2"><ChannelMark channel={c.ch} withLabel />
                      {!src[c.ch].connected && <Link href={`/integrations/${src[c.ch].id}`} title={`${src[c.ch].name} is not connected: sample data. Open integration.`}><StatusChip status="showcase" /></Link>}
                    </span>
                    <span className="shrink-0 text-ink-3 num">{c.leads} leads · {Number.isFinite(c.cpd) ? `${inrCompact(c.cpd)}/demo` : "no demos"}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-12">
          <Card>
            <CardHeader title="All campaigns" sub={`${campaigns.filter((c) => c.status === "live").length} live of ${campaigns.length}. Sorted by CRM leads.`} />
            <DataTable rows={ranked} columns={cols} rowKey={(s) => s.id} minWidth={1060} caption="All campaigns with spend, reach, CTR, CPL, leads, demos and conversion" />
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title="How do campaigns differ in reach profile?" sub="Reach, engagement, CTR, lead rate and cost efficiency, scored 0–100 by position among campaigns. Pick up to 3." action={<span className="font-mono text-[10px] text-ink-3">M45</span>} />
            <CardBody>
              <RadarPicker campaigns={radarCampaigns} initial={radarInit} total={stats.length} />
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-5">
          <Card className="h-full">
            <CardHeader title="Imports and sources"  sub="Platform rows arrive by CSV export. Showcase = API not connected." action={<span className="font-mono text-[10px] text-ink-3">M27</span>} />
            <CardBody className="space-y-0 px-0 sm:px-0">
              <ul className="divide-y divide-line border-y border-line">
                {imports.map((r) => (
                  <li key={r.ch} className="px-4 py-2.5 sm:px-5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-[13px] text-ink"><ChannelMark channel={r.ch} /><span className="truncate">{r.name}</span></span>
                      {r.connected ? <StatusChip status="connected" /> : <Link href={`/integrations/${r.id}`} aria-label={`${r.name}: Showcase, open integration`}><StatusChip status="showcase" /></Link>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-ink-3 num">
                      <span>{r.last ? `CSV import · last ${fmtDateTime(r.last.startedAt)}` : "No CSV imports yet"}</span>
                      <span>{num(r.rows)} rows this week</span>
                      {r.rejected > 0 && <span className="text-warn-ink">{r.rejected} rejected</span>}
                      {r.failed > 0 && <span className="text-danger">{r.failed} failed file{r.failed > 1 ? "s" : ""}</span>}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="px-4 pt-3 text-[12px] leading-5 text-ink-3 sm:px-5">Rejected rows had a <span className="font-mono text-[11px]">utm_campaign</span> that matches no campaign. Fix the UTM, then re-import that file.</p>
            </CardBody>
          </Card>
        </StaggerItem>
      </Stagger>
      <p className="mt-6 text-[11px] text-ink-3"><StatusChip status="sample" className="mr-1.5" />Synthetic data shaped like LinkedIn, Meta, Google Ads, WhatsApp and Mailchimp exports · {num(days.length)} campaign-day rows. † CTR is clicks / impressions; for WhatsApp and email it is clicks / delivered.</p>
    </>
  );
}
