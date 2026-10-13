import { Badge, Card, HBars, Mock, PageHead, Stat, Table } from "@/components/ui";
import { LineChart } from "@/components/charts";
import { ga4ByChannel, ga4Daily, ga4Devices, ga4Geo, ga4KeyEventsFormSubmit, ga4Pages, ga4Totals } from "@/data/ops";
import { leads } from "@/data/leads";
import { num, pct } from "@/lib/format";

export default function TrafficPage() {
  const t = ga4Totals;
  return (
    <>
      <PageHead title="GA4 traffic" sub="Site behaviour from the daily GA4 Data API pull (ga4_daily)." chips={<><Badge kind="mock">MOCK sample · GA4 not connected</Badge></>} />
      <div className="grid g-4">
        <Stat label="Sessions (M20)" value={num(t.sessions)} />
        <Stat label="Users" value={num(t.users)} />
        <Stat label="Engagement rate (M21)" value={pct(t.engaged / t.sessions)} note="Engaged sessions / sessions" />
        <Stat label="Avg engagement time (M22)" value={`${t.avgEngagementSecs}s`} />
      </div>
      <Card title="Sessions per day by channel group">
        <LineChart label="Sessions per day by channel group" labels={ga4Daily.map((d) => d.day)} series={[
          { name: "Paid Social", values: ga4Daily.map((d) => d.rows[0].sessions), color: "var(--s-1)" },
          { name: "Email", values: ga4Daily.map((d) => d.rows[1].sessions), color: "var(--s-2)" },
          { name: "Organic Search", values: ga4Daily.map((d) => d.rows[2].sessions), color: "var(--s-3)" },
          { name: "Direct", values: ga4Daily.map((d) => d.rows[3].sessions), color: "var(--s-4)" },
        ]} />
      </Card>
      <div className="grid g-2" style={{ marginTop: 16 }}>
        <Card title="Channel group"><Table label="GA4 channel groups" head={[{ t: "Channel" }, { t: "Sessions", num: true }, { t: "Engagement", num: true }]}>
          {ga4ByChannel.map((c) => <tr key={c.channel}><td>{c.channel}</td><td className="num">{num(c.sessions)}</td><td className="num">{pct(c.engaged / c.sessions, 0)}</td></tr>)}</Table></Card>
        <Card title="Top pages"><Table label="Top pages" head={[{ t: "Page" }, { t: "Sessions", num: true }, { t: "Engaged", num: true }]}>
          {ga4Pages.map((p) => <tr key={p.path}><td>{p.path}</td><td className="num">{num(p.sessions)}</td><td className="num">{pct(p.engagedPct, 0)}</td></tr>)}</Table></Card>
        <Card title="Device"><HBars color="var(--s-2)" rows={ga4Devices.map((d) => ({ label: d.label, value: d.share * 100, max: 100, right: pct(d.share, 0) }))} /></Card>
        <Card title="Geography (state)"><HBars color="var(--s-3)" rows={ga4Geo.map((d) => ({ label: d.label, value: d.share * 100, max: 45, right: pct(d.share, 0) }))} /></Card>
      </div>
      <Card title="Reconciliation: GA4 vs CRM (M23)">
        <p>GA4 key events (form_submit): <strong>{ga4KeyEventsFormSubmit}</strong> · CRM leads: <strong>{leads.length}</strong> · gap {ga4KeyEventsFormSubmit - leads.length}.</p>
        <p className="sub" style={{ marginTop: 6 }}>A gap is expected (duplicate or failed submits, bots). Shown rather than hidden so Venket does not trust one source blindly. Consent gating also means CRM visit counts are lower than GA4 sessions.</p>
      </Card>
    </>
  );
}
