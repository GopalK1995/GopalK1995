import { PageHead, Stat, Card, HBars, Mock } from "@/components/ui";
import { ColumnChart } from "@/components/charts";
import { funnel, leadsPerDay, tourPlayers, slaStats, allCampaignStats } from "@/lib/metrics";
import { leads } from "@/data/leads";
import { dur, inr, num, pct } from "@/lib/format";

export default function FunnelPage() {
  const f = funnel();
  const days = leadsPerDay();
  const sla = slaStats();
  const spend = allCampaignStats().reduce((a, c) => a + c.spend, 0);
  const drop = f.slice(1).reduce((w, s) => (s.stepRate < w.stepRate ? s : w));
  const won = f[f.length - 1].n;
  return (
    <>
      <PageHead title="Funnel overview" sub="Where prospects drop between visit and win. Event names match the landing page tracker." chips={<Mock />} />
      <div className="grid g-4">
        <Stat label="Leads (M5 numerator)" value={num(leads.length)} note={`Visit-to-lead ${pct(leads.length / f[0].n, 2)}`} />
        <Stat label="Demos booked (M10)" value={num(f[4].n)} note={`Lead-to-demo ${pct(f[4].n / leads.length)}`} />
        <Stat label="Won (M6)" value={num(won)} note={`Lead-to-won ${pct(won / leads.length)}`} />
        <Stat label="Median first response (M14)" value={dur(sla.median)} note={`${pct(sla.pctWithin, 0)} within 4 h SLA`} />
      </div>
      <div className="grid g-21">
        <Card title="Funnel" sub="Distinct people per step. Bar length is square-root scaled so small steps stay visible; numbers are exact. Visit to submit counts consented visitors only.">
          <div className="funnel"><HBars fmt={num} rows={f.map((s) => ({ label: s.label, value: Math.sqrt(s.n), max: Math.sqrt(f[0].n), right: `${num(s.n)} · ${Number.isNaN(s.stepRate) ? "start" : pct(s.stepRate, 0)}` }))} /></div>
          <div className="callout">Biggest step drop: <strong>{drop.label}</strong> ({pct(drop.stepRate, 0)} of the previous step). Product tour started by {tourPlayers()} leads (side branch, event <code>tour_play</code>).</div>
          <p className="sub" style={{ marginTop: 10 }}>Step rate = people at step / people at previous step. Top-of-funnel is under-counted vs GA4 because tracking needs consent.</p>
        </Card>
        <Card title="Spend in period" sub="Sum of imported campaign spend">
          <div className="stat"><div className="value">{inr(spend)}</div><div className="note">Blended cost per lead: {inr(spend / leads.length)} (paid + organic leads)</div></div>
          <p className="sub" style={{ marginTop: 10 }}>LinkedIn figures are MOCK / CSV; Meta is CSV; email spend not tracked.</p>
        </Card>
      </div>
      <Card title="New leads per day" sub="form_submit events becoming leads">
        <ColumnChart labels={days.map((d) => d.day)} values={days.map((d) => d.n)} label="New leads per day, last 30 days" />
      </Card>
    </>
  );
}
