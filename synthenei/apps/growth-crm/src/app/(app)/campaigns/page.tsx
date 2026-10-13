import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import { CHANNEL_LABEL, campaignStats, radarProfiles } from "@/lib/data/metrics";
import { fmtDate, inr, inrCompact, num, numCompact, pct, ratio } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Gate } from "@/components/ui/gate";
import { Kpi } from "@/components/ui/kpi";
import { PageHeader, Table, td, tdNum, th, thNum } from "@/components/ui/misc";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { ChannelMark } from "@/components/ui/domain";
import { HBar } from "@/components/charts/hbar";
import { RadarPicker } from "./radar-picker";
import { cn } from "@/lib/utils";
import type { Campaign } from "@/lib/data/types";

export const metadata = { title: "Campaigns" };
const STATUS_TONE = { live: "success", paused: "warn", ended: "neutral" } as const;

export default async function Campaigns() {
  const { ds } = await pageCtx();
  const [campaigns, days, leads, deals] = await Promise.all([ds.campaigns(), ds.campaignDays(), ds.leads(), ds.deals()]);
  const stats = campaigns.map((c) => campaignStats(c, days, leads, deals));
  const sum = (k: "spend" | "leads" | "demos" | "revenue" | "clicks" | "impressions") => stats.reduce((a, s) => a + s[k], 0);
  const channels = [...new Set(campaigns.map((c) => c.channel))] as Campaign["channel"][];
  const byChannel = channels.map((ch) => {
    const xs = stats.filter((s) => s.channel === ch);
    const spend = xs.reduce((a, s) => a + s.spend, 0), l = xs.reduce((a, s) => a + s.leads, 0), d = xs.reduce((a, s) => a + s.demos, 0);
    return { ch, spend, leads: l, demos: d, cpl: ratio(spend, l), cpd: ratio(spend, d), n: xs.length };
  }).sort((a, b) => b.leads - a.leads);
  const radar = radarProfiles(stats);
  const ranked = [...stats].sort((a, b) => b.leads - a.leads);
  const cpl = stats.filter((s) => s.leads > 0).map((s) => ({ label: s.name.split(" — ")[0], value: Math.round(s.cpl), note: `${s.leads} leads · ${CHANNEL_LABEL[s.channel]}` })).sort((a, b) => a.value - b.value);
  const best = [...stats].filter((s) => s.demos >= 3).sort((a, b) => a.costPerDemo - b.costPerDemo)[0];

  return (
    <>
      <PageHeader eyebrow="Marketing · last 90 days" title="Campaigns"
        sub="Every campaign on cost and outcome. Leads are counted in the CRM, so platform numbers can differ (see the gap column)."
        actions={<><Gate can="importCsv"><Button><Upload />Import results CSV</Button></Gate><Gate can="editCampaigns"><Button variant="primary"><Plus />New campaign</Button></Gate></>} />

      <Stagger className="grid gap-4 lg:grid-cols-12">
        <StaggerItem className="grid gap-4 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-4">
          <Kpi label="Spend" metric="M8" value={sum("spend")} format="inr" foot={<>{campaigns.filter((c) => c.status === "live").length} live of {campaigns.length} campaigns</>} />
          <Kpi label="Leads in CRM" metric="M9" value={sum("leads")} foot={<>CPL {inr(ratio(sum("spend"), sum("leads")))}</>} />
          <Kpi label="Cost per demo" metric="M11" value={ratio(sum("spend"), sum("demos"))} format="inr" foot={<>{sum("demos")} demos booked from campaign leads</>} />
          <Kpi label="Won value from campaigns" metric="M43" value={sum("revenue")} format="inr" foot={<>{ratio(sum("revenue"), sum("spend")).toFixed(1)}× return on spend (first touch)</>} />
        </StaggerItem>

        {/* channel strip: one dense row, not five identical cards */}
        <StaggerItem className="lg:col-span-12">
          <Card>
            <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-5 lg:divide-x">
              {byChannel.map((c) => (
                <div key={c.ch} className="p-4">
                  <div className="flex items-center justify-between"><ChannelMark channel={c.ch} withLabel /><span className="text-[11px] text-ink-3">{c.n} campaign{c.n > 1 ? "s" : ""}</span></div>
                  <div className="mt-2 text-[20px] font-semibold num">{inrCompact(c.spend)}</div>
                  <dl className="mt-1 grid grid-cols-3 gap-2 text-[11px]">
                    <div><dt className="text-ink-3">Leads</dt><dd className="font-medium num">{c.leads}</dd></div>
                    <div><dt className="text-ink-3">CPL</dt><dd className="font-medium num">{Number.isFinite(c.cpl) ? inrCompact(c.cpl) : "–"}</dd></div>
                    <div><dt className="text-ink-3">Per demo</dt><dd className="font-medium num">{Number.isFinite(c.cpd) ? inrCompact(c.cpd) : "–"}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title="Reach profile" sub="Compare 2–3 campaigns on reach, engagement, CTR, lead rate and cost efficiency" action={<span className="font-mono text-[10px] text-ink-3">M45</span>} />
            <CardBody>
              <RadarPicker data={radar} campaigns={stats.map((s, i) => ({ id: s.id, label: s.name.split(" — ")[0], slot: i }))} initial={ranked.slice(0, 3).map((s) => s.id)} />
            </CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-5">
          <Card className="h-full">
            <CardHeader title="Cost per lead" sub="Lowest first. Email has tool cost only." action={<span className="font-mono text-[10px] text-ink-3">M9</span>} />
            <CardBody>
              <HBar label="Cost per lead by campaign" data={cpl} format="inr" highlight={cpl[0]?.label} labelWidth={150} valueLabel="Cost per lead" />
              {best && <p className="mt-3 rounded-sm bg-accent-soft px-3 py-2 text-[12px] text-ink-2"><span className="font-medium text-ink">{best.name}</span> books demos at {inr(best.costPerDemo)} each, the lowest of any campaign with 3+ demos.</p>}
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-12">
          <Card>
            <CardHeader title="All campaigns" sub="Spend and platform metrics from imports; leads, demos and revenue from the CRM" />
            <div className="hidden md:block">
              <Table minWidth={1080}>
                <thead><tr className="border-y border-line bg-paper/60">
                  <th className={th}>Campaign</th><th className={th}>Status</th><th className={thNum}>Spend</th><th className={thNum}>Impr.</th><th className={thNum}>CTR</th>
                  <th className={thNum}>Leads</th><th className={thNum}>CPL</th><th className={thNum}>Demos</th><th className={thNum}>Per demo</th><th className={thNum}>Won</th><th className={thNum} title="Platform leads minus CRM leads (M13)">Gap</th>
                </tr></thead>
                <tbody>
                  {ranked.map((s) => (
                    <tr key={s.id} className="border-b border-line last:border-0 hover:bg-paper/60">
                      <td className={cn(td, "h-14 max-w-[340px]")}>
                        <div className="flex items-center gap-2.5"><ChannelMark channel={s.channel} /><div className="min-w-0"><Link href={`/campaigns/${s.id}`} className="block truncate font-medium hover:text-accent">{s.name}</Link><span className="font-mono text-[11px] text-ink-3">{s.utmCampaign} · from {fmtDate(s.startDate + "T06:00:00Z")}</span></div></div>
                      </td>
                      <td className={td}><Badge tone={STATUS_TONE[s.status]}>{s.status[0].toUpperCase() + s.status.slice(1)}</Badge></td>
                      <td className={tdNum}>{inr(s.spend)}</td>
                      <td className={tdNum}>{numCompact(s.impressions)}</td>
                      <td className={tdNum}>{pct(s.ctr, 2)}</td>
                      <td className={cn(tdNum, "font-medium")}>{s.leads}</td>
                      <td className={tdNum}>{Number.isFinite(s.cpl) ? inr(s.cpl) : "–"}</td>
                      <td className={tdNum}>{s.demos}</td>
                      <td className={tdNum}>{Number.isFinite(s.costPerDemo) ? inr(s.costPerDemo) : "–"}</td>
                      <td className={tdNum}>{s.revenue ? inrCompact(s.revenue) : "–"}</td>
                      <td className={cn(tdNum, s.gap !== 0 && "text-warn-ink")}>{s.gap > 0 ? `+${s.gap}` : s.gap}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            {/* mobile: stacked cards (title, two facts, one action) */}
            <ul className="divide-y divide-line border-t border-line md:hidden">
              {ranked.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <ChannelMark channel={s.channel} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{s.name}</div>
                    <div className="text-[12px] text-ink-3 num">{inrCompact(s.spend)} spend · {s.leads} leads · {Number.isFinite(s.costPerDemo) ? `${inrCompact(s.costPerDemo)}/demo` : "no demos"}</div>
                  </div>
                  <Link href={`/campaigns/${s.id}`} className="shrink-0 text-[12px] font-medium text-accent">Open</Link>
                </li>
              ))}
            </ul>
          </Card>
        </StaggerItem>
      </Stagger>
      <p className="mt-6 text-[11px] text-ink-3">Data source: synthetic sample shaped like LinkedIn, Meta, Google Ads, WhatsApp and Mailchimp exports. {num(days.length)} campaign-day rows.</p>
    </>
  );
}
