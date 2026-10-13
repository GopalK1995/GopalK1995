import { Badge, Card, HBars, Mock, PageHead, Stat, Table } from "@/components/ui";
import { allCampaignStats } from "@/lib/metrics";
import { inr, num, pct } from "@/lib/format";

const na = (n: number, f: (x: number) => string) => (Number.isFinite(n) ? f(n) : "n/a");
export default function CampaignsPage() {
  const cs = allCampaignStats();
  const by = (ch: string) => { const x = cs.filter((c) => c.channel === ch); return { spend: x.reduce((a, c) => a + c.spend, 0), leads: x.reduce((a, c) => a + c.leads, 0), demos: x.reduce((a, c) => a + c.demos, 0) }; };
  const paid = cs.filter((c) => c.spend > 0);
  return (
    <>
      <PageHead title="Campaigns" sub="Email, LinkedIn and Meta side by side. Leads are CRM leads joined on utm_campaign, not platform-reported leads." chips={<Mock />} />
      <div className="grid g-3">
        {(["email", "linkedin", "meta"] as const).map((ch) => { const s = by(ch); return (
          <Stat key={ch} label={ch === "linkedin" ? "LinkedIn (MOCK / CSV)" : ch === "meta" ? "Meta (CSV)" : "Email (CSV)"} value={`${s.leads} leads`} note={`Spend ${inr(s.spend)} · CPL ${s.spend ? inr(s.spend / s.leads) : "n/a"} · ${s.demos} demos`} />
        ); })}
      </div>
      <Card title="All campaigns">
        <Table label="Campaign performance" head={[{ t: "Campaign" }, { t: "Channel" }, { t: "Data" }, { t: "Spend", num: true }, { t: "Reach", num: true }, { t: "Clicks", num: true }, { t: "CTR", num: true }, { t: "Leads", num: true }, { t: "CPL", num: true }, { t: "Demos", num: true }, { t: "Cost / demo", num: true }, { t: "Lead→demo", num: true }, { t: "Platform vs CRM leads", num: true }]}>
          {cs.map((c) => (
            <tr key={c.id}>
              <td>{c.name}<div className="sub">{c.utmCampaign}</div></td><td>{c.channel}</td>
              <td><Badge kind={c.dataSource === "mock" ? "mock" : "mute"}>{c.dataSource === "mock" ? "MOCK" : c.dataSource.toUpperCase()}</Badge></td>
              <td className="num">{c.spend ? inr(c.spend) : "n/a"}</td><td className="num">{num(c.reach)}</td><td className="num">{num(c.clicks)}</td><td className="num">{pct(c.ctr)}</td>
              <td className="num">{c.leads}</td><td className="num">{na(c.cpl, inr)}</td><td className="num">{c.demos}</td><td className="num">{na(c.costPerDemo, inr)}</td><td className="num">{na(c.leadToDemo, (x) => pct(x, 0))}</td>
              <td className="num">{c.gap === null ? "n/a" : `${c.platformLeads} vs ${c.leads}`}</td>
            </tr>
          ))}
        </Table>
        <p className="sub" style={{ marginTop: 8 }}>CTR = clicks / impressions (email: delivered). CPL = spend / CRM leads. Cost per demo = spend / demos booked. Email spend is not tracked, so CPL is n/a. Small counts: read rates with care.</p>
      </Card>
      <div className="grid g-2" style={{ marginTop: 16 }}>
        <Card title="Cost per lead (paid campaigns)"><HBars rows={paid.map((c) => ({ label: c.utmCampaign, value: Number.isFinite(c.cpl) ? c.cpl : 0 }))} fmt={inr} /></Card>
        <Card title="Cost per demo (paid campaigns)"><HBars color="var(--s-3)" rows={paid.map((c) => ({ label: c.utmCampaign, value: Number.isFinite(c.costPerDemo) ? c.costPerDemo : 0, right: na(c.costPerDemo, inr) }))} fmt={inr} /></Card>
      </div>
    </>
  );
}
