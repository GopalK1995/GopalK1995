import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Pause, Pencil, Play } from "lucide-react";
import { maskName, pageCtx } from "@/lib/data/context";
import { CHANNEL_LABEL, LEAD_STAGE_LABEL, campaignStats, isDemo } from "@/lib/data/metrics";
import { fmtDate, fmtDateY, inr, inrCompact, num, numCompact, pct, ratio } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusChip } from "@/components/ui/badge";
import { Kpi } from "@/components/ui/kpi";
import { Dl, Meter, PageHeader, ScoreChip } from "@/components/ui/misc";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { ChannelMark, LeadStageBadge } from "@/components/ui/domain";
import type { Lead } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { CHANNEL_CHIP, allStats, dailyJoin, radarScores, shortName, sourceState, weekBuckets, inBucket, leadDay, DAY_MS } from "../_lib/marketing";
import { RadarPicker, type RadarCampaign } from "../_components/radar-compare";
import { ImportCsvDialog } from "../_components/dialogs";
import { ActionButton } from "../_components/action";
import { editCampaign, exportCampaignLeads, setCampaignStatus } from "../_actions";
import { AttributionToggle, CampaignFunnel, NoteDialog, TrendPanel } from "./_components/detail-client";

const STATUS_TONE = { live: "success", paused: "warn", ended: "neutral" } as const;
const STATUS_LABEL = { live: "Live", paused: "Paused", ended: "Ended" } as const;
/** Landing-visit share of clicks (GA4 sample until connected): ad clicks lose some visits to bounces before page load. */
const VISIT_PER_CLICK: Record<string, number> = { linkedin: 0.81, meta: 0.74, google_ads: 0.9, whatsapp: 0.86, email: 0.88 };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { ds } = await pageCtx();
  const c = await ds.campaign((await params).id);
  return { title: c ? shortName(c.name) : "Campaign" };
}

/** Compact horizontal bars in HTML for small categorical breakdowns (sorted, counts printed). */
function BarList({ title, rows, total }: { title: string; rows: { label: string; n: number }[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <figure aria-label={`${title}: ${rows.map((r) => `${r.label} ${r.n}`).join(", ")}`}>
      <figcaption className="mb-2 text-[12px] font-medium text-ink-2">{title}</figcaption>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[minmax(0,112px)_1fr_56px] items-center gap-2 text-[12px]">
            <span className={cn("truncate", r.label === "Unknown" ? "text-ink-3" : "text-ink-2")} title={r.label}>{r.label}</span>
            <span className="h-2 rounded-r-[4px] bg-paper-2"><span className="block h-2 rounded-r-[4px] bg-chart-1" style={{ width: `${(r.n / max) * 100}%` }} /></span>
            <span className="text-right num text-ink">{r.n}<span className="ml-1 text-ink-3">{pct(r.n / (total || 1), 0)}</span></span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

export default async function CampaignDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ds, now, masked } = await pageCtx();
  const c = await ds.campaign(id);
  if (!c) notFound();
  const [campaigns, days, leads, deals, accounts, integrations, team] = await Promise.all([ds.campaigns(), ds.campaignDays(), ds.leads(), ds.deals(), ds.accounts(), ds.integrations(), ds.team()]);
  const owner = team.find((t) => t.id === c.ownerId)?.name;
  const stats = allStats(campaigns, days, leads, deals);
  const s = campaignStats(c, days, leads, deals);
  const myDays = days.filter((d) => d.campaignId === c.id);
  const linked = leads.filter((l) => l.campaignId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const src = sourceState(integrations)[c.channel];
  const acc = new Map(accounts.map((a) => [a.id, a]));

  // Header facts
  const budgetUsed = ratio(s.spend, c.budget);
  const weeks = weekBuckets(now, 12);
  const spendW = weeks.map((w) => myDays.filter((d) => inBucket(d.date, w)).reduce((a, d) => a + d.spend, 0));
  const leadsW = weeks.map((w) => linked.filter((l) => inBucket(leadDay(l), w)).length);

  // Radar: this campaign vs channel average vs best campaign (highest mean score).
  const scores = radarScores(stats);
  const peers = stats.filter((x) => x.channel === c.channel);
  const avgOf = (xs: typeof stats) => [0, 1, 2, 3, 4].map((i) => Math.round(xs.reduce((a, x) => a + scores.get(x.id)![i], 0) / xs.length));
  const avgLabel = peers.length > 1 ? `${CHANNEL_LABEL[c.channel]} average` : "All-campaign average";
  const avg = avgOf(peers.length > 1 ? peers : stats);
  const mean = (x: number[]) => x.reduce((a, v) => a + v, 0) / x.length;
  const bestS = [...stats].filter((x) => x.id !== c.id).sort((a, b) => mean(scores.get(b.id)!) - mean(scores.get(a.id)!))[0];
  const radar: RadarCampaign[] = [
    { id: c.id, label: "This campaign", scores: scores.get(c.id)!, raw: [numCompact(s.reach), pct(s.engagementRate, 1), pct(s.ctr, 2), pct(s.leadRate, 1), s.spend === 0 ? "no spend" : `${inrCompact(s.cpl)} CPL`] },
    { id: "avg", label: avgLabel, scores: avg, raw: ["", "", "", "", ""] },
    ...(bestS ? [{ id: bestS.id, label: `Best: ${shortName(bestS.name)}`, scores: scores.get(bestS.id)!, raw: [numCompact(bestS.reach), pct(bestS.engagementRate, 1), pct(bestS.ctr, 2), pct(bestS.leadRate, 1), bestS.spend === 0 ? "no spend" : `${inrCompact(bestS.cpl)} CPL`] }] : []),
  ];

  // Funnel: impressions -> clicks -> landing visits -> leads -> demos -> won
  const visits = Math.round(s.clicks * (VISIT_PER_CLICK[c.channel] ?? 0.85));
  const funnel = [
    { key: "imp", label: c.channel === "email" || c.channel === "whatsapp" ? "Delivered" : "Impressions", n: s.impressions },
    { key: "clk", label: c.channel === "whatsapp" ? "Link taps" : "Clicks", n: s.clicks },
    { key: "vis", label: "Landing visits", n: visits, note: "GA4 sample until GA4 is connected" },
    { key: "lead", label: "Leads (CRM)", n: s.leads },
    { key: "demo", label: "Demos booked", n: s.demos },
    { key: "won", label: "Won", n: s.won },
  ];

  // Audience summary of linked leads
  const group = (key: (l: Lead) => string, order?: string[]) => {
    const m = new Map<string, number>();
    linked.forEach((l) => m.set(key(l), (m.get(key(l)) ?? 0) + 1));
    const rows = [...m.entries()].map(([label, n]) => ({ label, n }));
    return order ? order.filter((o) => m.has(o)).map((o) => ({ label: o, n: m.get(o)! })) : rows.sort((a, b) => b.n - a.n).slice(0, 6);
  };
  const byRole = group((l) => l.title);
  const byDistrict = group((l) => acc.get(l.accountId)?.district ?? "Unknown");
  const bySize = group((l) => acc.get(l.accountId)?.size ?? "Unknown", ["Solo", "2–5", "6–20", "21–50", "50+", "Unknown"]);

  // Attribution: first touch = this campaign sourced the lead; last touch = the lead's final touch was this channel.
  const wonVal = (ls: Lead[]) => deals.filter((d) => d.stage === "won" && ls.some((l) => l.id === d.leadId)).reduce((a, d) => a + d.value, 0);
  const lastLeads = linked.filter((l) => l.lastTouch === c.channel);
  const wonN = (ls: Lead[]) => deals.filter((d) => d.stage === "won" && ls.some((l) => l.id === d.leadId)).length; // won deals, as in the KPI tile
  const firstA = { leads: linked.length, demos: linked.filter(isDemo).length, won: wonN(linked), revenue: inrCompact(wonVal(linked)) };
  const lastA = { leads: lastLeads.length, demos: lastLeads.filter(isDemo).length, won: wonN(lastLeads), revenue: inrCompact(wonVal(lastLeads)) };
  const movedTo = new Map<string, number>();
  linked.filter((l) => l.lastTouch !== c.channel).forEach((l) => movedTo.set(CHANNEL_LABEL[l.lastTouch], (movedTo.get(CHANNEL_LABEL[l.lastTouch]) ?? 0) + 1));

  // UTM breakdown + naming convention check {channel}_{district|statewide}_{theme}_{yyyymm}
  const utmRows = (() => {
    const m = new Map<string, { source: string; medium: string; campaign: string; leads: number; demos: number }>();
    linked.forEach((l) => {
      const k = `${l.utm.source}|${l.utm.medium}|${l.utm.campaign ?? "(not set)"}`;
      const r = m.get(k) ?? { source: l.utm.source, medium: l.utm.medium, campaign: l.utm.campaign ?? "(not set)", leads: 0, demos: 0 };
      r.leads++; if (isDemo(l)) r.demos++; m.set(k, r);
    });
    return [...m.values()].sort((a, b) => b.leads - a.leads);
  })();
  const conventionOk = /^(li|wa|em|meta|gads)_[a-z]+_[a-z0-9_]+_\d{6}$/.test(c.utmCampaign);
  const nowMs = new Date(now).getTime();

  const leadCols: Column<Lead>[] = [
    { key: "name", header: "Lead", mobile: "title", cell: (l) => {
      const nm = masked ? maskName(l.name) : l.name;
      return <div className="min-w-0"><Link href={`/leads/${l.id}`} className="block truncate font-medium text-ink hover:text-accent">{nm}</Link><span className="hidden text-[11px] text-ink-3 md:inline">{l.title}</span></div>;
    } },
    { key: "firm", header: "Firm", cell: (l) => <span className="block max-w-[220px] truncate">{acc.get(l.accountId)?.name ?? "Unknown"}</span> },
    { key: "district", header: "District", mobile: "fact", cell: (l) => acc.get(l.accountId)?.district ?? "Unknown" },
    { key: "stage", header: "Stage", mobile: "fact", cell: (l) => <LeadStageBadge stage={l.stage} /> },
    { key: "score", header: "Score", align: "right", cell: (l) => <ScoreChip score={l.score} /> },
    { key: "last", header: "Last touch", cell: (l) => <span className={cn(l.lastTouch !== c.channel && "text-ink-2")}>{CHANNEL_LABEL[l.lastTouch]}</span> },
    { key: "created", header: "Created", align: "right", cell: (l) => <span title={fmtDateY(l.createdAt)}>{Math.round((nowMs - new Date(l.createdAt).getTime()) / DAY_MS)}d ago</span> },
    { key: "open", header: <span className="sr-only">Open</span>, mobile: "action", className: "md:hidden", cell: (l) => <Link href={`/leads/${l.id}`} className="font-medium text-accent">Open</Link> },
  ];

  return (
    <>
      <Link href="/campaigns" className="mb-3 inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" aria-hidden />All campaigns</Link>
      <PageHeader eyebrow={<span className="inline-flex items-center gap-2 normal-case tracking-normal"><ChannelMark channel={c.channel} withLabel />{!src.connected && <Link href={`/integrations/${src.id}`} title={`${src.name} not connected: sample data`}><StatusChip status="showcase" /></Link>}</span>}
        title={c.name}
        sub={<>{c.objective}. <span className="num">{fmtDateY(c.startDate + "T06:00:00Z")} – {c.endDate ? fmtDateY(c.endDate + "T06:00:00Z") : "ongoing"}</span>{owner ? ` · owner ${owner}` : ""}</>}
        actions={<>
          <ActionButton can="editCampaigns" action={setCampaignStatus.bind(null, c.id, c.status === "paused" ? "live" : "paused")} disabled={c.status === "ended"}>{c.status === "paused" ? <><Play />Resume</> : <><Pause />Pause</>}</ActionButton>
          <NoteDialog campaignId={c.id} />
          <ImportCsvDialog campaigns={[{ id: c.id, name: c.name, channel: c.channel }]} campaignId={c.id} />
          <ActionButton can="editCampaigns" variant="primary" action={editCampaign.bind(null, c.id)}><Pencil />Edit</ActionButton>
        </>}>
        <div className="mt-3 flex max-w-md items-center gap-3">
          <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
          <Meter value={s.spend} max={c.budget} tone={budgetUsed > 0.95 ? "warn" : "accent"} className="flex-1" />
          <span className="shrink-0 text-[12px] text-ink-2 num">{inrCompact(s.spend)} of {inrCompact(c.budget)} budget ({pct(budgetUsed, 0)})</span>
        </div>
      </PageHeader>

      <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <StaggerItem className="grid grid-cols-2 gap-3 sm:gap-4 lg:col-span-12 lg:grid-cols-4 max-sm:[&_svg[preserveAspectRatio]]:hidden max-sm:[&>div]:p-3 max-sm:[&_.text-\[26px\]]:text-[20px]">
          <Kpi label="Spend" metric="M8" value={s.spend} format="inr" spark={spendW} foot={<>{c.channel === "email" ? "Mailchimp tool cost" : `${inr(ratio(s.spend, myDays.length))} per day average`}</>} />
          <Kpi label="Leads in CRM" metric="M9" value={s.leads} spark={leadsW} foot={<>CPL {s.spend ? inr(s.cpl) : "₹0 (no paid spend)"} · platform says {s.platformLeads}</>} />
          <Kpi label="Demos booked" metric="M10" value={s.demos} foot={<>{Number.isFinite(s.costPerDemo) && s.spend ? `${inr(s.costPerDemo)} per demo` : "no paid spend"} · {pct(s.leadToDemo, 0)} of leads</>} />
          <Kpi label="Won value" metric="M43" value={s.revenue} format="inrCompact" foot={<>{s.won} deal{s.won === 1 ? "" : "s"} · {s.spend ? `${(s.revenue / s.spend).toFixed(1)}× ROAS` : "no spend to compare"}</>} />
        </StaggerItem>
        <StaggerItem className="lg:col-span-12">
          <Card>
            <dl className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
              {([["Reach", numCompact(s.reach), "M8"], ["Impressions", numCompact(s.impressions), ""], ["CTR", pct(s.ctr, 2), "M7"], ["Engagement rate", pct(s.engagementRate, 1), "M46"]] as const).map(([k, v, m]) => (
                <div key={k} className="px-4 py-3"><dt className="flex justify-between text-[12px] text-ink-3">{k}<span className="font-mono text-[10px]">{m}</span></dt><dd className="mt-0.5 text-[18px] font-semibold text-ink num">{v}</dd></div>
              ))}
            </dl>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-12">
          <Card>
            <CardHeader title="Is spend turning into leads day by day?" sub="Daily spend from the platform export beside CRM leads by created date (IST)" />
            <CardBody><TrendPanel days={dailyJoin(myDays, linked)} name={shortName(c.name)} /></CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="flex flex-col gap-4 lg:col-span-6">
          <Card>
            <CardHeader title="Where do people drop off?" sub="Impressions to won deals for this campaign" />
            <CardBody><CampaignFunnel steps={funnel} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Who gets the credit?" sub="First touch: this campaign sourced the lead. Last touch: the lead's final touch was still this campaign's channel." />
            <CardBody>
              <AttributionToggle first={firstA} last={lastA} />
              {movedTo.size > 0 && (
                <p className="mt-3 text-[12px] leading-5 text-ink-2">
                  {linked.length - lastLeads.length} of {linked.length} leads had a later touch elsewhere: {[...movedTo.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}. Multi-touch credit is out of scope at this volume.
                </p>
              )}
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-6">
          <Card className="h-full">
            <CardHeader title="How does it compare?" sub={`This campaign vs ${avgLabel === "All-campaign average" ? "the all-campaign average" : `the ${avgLabel}`} vs the strongest other campaign`} action={<span className="font-mono text-[10px] text-ink-3">M45</span>} />
            <CardBody><RadarPicker campaigns={radar} initial={radar.map((r) => r.id)} total={stats.length} height={320} /></CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title="Who responded?" sub={`${linked.length} CRM leads by role, district and firm size`} />
            <CardBody className="grid gap-5 sm:grid-cols-2">
              <BarList title="Role" rows={byRole} total={linked.length} />
              <BarList title="District" rows={byDistrict} total={linked.length} />
              <BarList title="Firm size (lawyers)" rows={bySize} total={linked.length} />
              <div className="text-[12px] leading-5 text-ink-2">
                <div className="mb-2 font-medium">Targeted audience</div>
                <p>{c.audience}</p>
                <p className="mt-1 text-ink-3 num">{c.audienceSize ? `${num(c.audienceSize)} people in the platform audience` : "Keyword targeting, no fixed audience size"}</p>
              </div>
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="flex flex-col gap-4 lg:col-span-5">
          <Card>
            <CardHeader title="Creative" sub={c.creative.format} action={<StatusChip status="showcase" label="Concept copy, not sent" />} />
            <CardBody>
              <div className="rounded-sm border border-line bg-paper p-3">
                <div className="text-[14px] font-semibold leading-5 text-ink">{c.creative.headline}</div>
                <p className="mt-1.5 text-[13px] leading-5 text-ink-2">{c.creative.body}</p>
                <span className="mt-3 inline-flex h-7 items-center rounded-sm border border-line-strong bg-surface px-2.5 text-[12px] font-medium text-ink">{c.creative.cta}</span>
              </div>
              <Dl className="mt-4" items={[["utm_campaign", <span key="u" className="font-mono text-[12px]">{c.utmCampaign}</span>], ["Data source", <span key="d">{src.name} · {c.dataSource === "mock" ? "sample" : c.dataSource.toUpperCase()}</span>]]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="UTM breakdown" sub="How linked leads were tagged when they arrived" />
            <CardBody className="px-0 sm:px-0">
              <div className="scrollbar-thin overflow-x-auto">
                <table className="w-full min-w-[400px] border-collapse text-[13px]">
                  <caption className="sr-only">Leads by UTM source, medium and campaign</caption>
                  <thead><tr className="border-y border-line bg-paper/60 text-[11px] uppercase tracking-[0.05em] text-ink-3">
                    <th scope="col" className="h-9 px-4 text-left font-medium sm:px-5">utm_source / medium</th><th scope="col" className="px-3 text-left font-medium">utm_campaign</th><th scope="col" className="px-3 text-right font-medium">Leads</th><th scope="col" className="px-4 text-right font-medium sm:px-5">Demos</th>
                  </tr></thead>
                  <tbody>
                    {utmRows.map((r) => (
                      <tr key={r.source + r.medium + r.campaign} className="border-b border-line last:border-0">
                        <td className="h-10 px-4 font-mono text-[12px] sm:px-5">{r.source} / {r.medium}</td>
                        <td className={cn("px-3 font-mono text-[12px]", r.campaign === "(not set)" && "text-warn-ink")}>{r.campaign}</td>
                        <td className="px-3 text-right num">{r.leads}</td><td className="px-4 text-right num sm:px-5">{r.demos}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className={cn("mx-4 mt-3 rounded-sm px-3 py-2 text-[12px] leading-5 sm:mx-5", conventionOk ? "bg-success-soft text-ink-2" : "bg-warn-soft text-ink-2")}>
                {conventionOk ? "Follows the naming convention." : <>
                  <span className="font-medium text-warn-ink">Off convention.</span> <span className="font-mono text-[11px]">{c.utmCampaign}</span> predates the rule <span className="font-mono text-[11px]">{"{channel}_{district|statewide}_{theme}_{yyyymm}"}</span>. Keep it for this campaign so attribution stays intact; new campaigns get it generated.
                </>}
              </p>
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-12">
          <Card>
            <CardHeader title="Leads from this campaign" sub={`${linked.length} leads, first touch. ${masked ? "Names masked for your role." : "Newest first."}`}
              action={<ActionButton can="exportCsv" size="sm" action={exportCampaignLeads.bind(null, c.id)}><Download />Export</ActionButton>} />
            <DataTable rows={linked} columns={leadCols} rowKey={(l) => l.id} minWidth={860} caption={`Leads attributed to ${c.name}`}
              empty="No CRM leads from this campaign yet." emptyHint={<>Leads appear once a form submit carries <span className="font-mono">{c.utmCampaign}</span>.</>} />
          </Card>
        </StaggerItem>
      </Stagger>
      <p className="mt-6 text-[11px] text-ink-3"><StatusChip status="sample" className="mr-1.5" />Spend, impressions and clicks are sample rows shaped like a {CHANNEL_CHIP[c.channel]} export. Stage labels: {LEAD_STAGE_LABEL.demo_booked} and later count as demos.</p>
    </>
  );
}
