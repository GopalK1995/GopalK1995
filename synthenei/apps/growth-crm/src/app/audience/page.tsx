import { Card, HBars, Mock, PageHead, Stat } from "@/components/ui";
import { leads } from "@/data/leads";
import { countBy, icpMatch } from "@/lib/metrics";
import { num, pct } from "@/lib/format";

const rows = (xs: { label: string; n: number }[]) => xs.map((x) => ({ label: x.label, value: x.n, right: `${x.n} · ${pct(x.n / leads.length, 0)}` }));
export default function AudiencePage() {
  const icp = leads.filter(icpMatch).length;
  const personal = leads.filter((l) => l.personalEmail).length;
  const unknown = leads.filter((l) => !l.firmSize).length;
  return (
    <>
      <PageHead title="Audience / ICP" sub="Are we reaching managing partners, owners and senior advocates at real firms?" chips={<Mock />} />
      <div className="grid g-3">
        <Stat label="ICP match (M15)" value={pct(icp / leads.length, 0)} note={`${icp} of ${leads.length}: owner/partner or senior advocate with a work email`} />
        <Stat label="Personal-email share (M16)" value={pct(personal / leads.length, 0)} note={`${num(personal)} leads used a personal address`} />
        <Stat label="Firm size unknown" value={pct(unknown / leads.length, 0)} note="Enriched after first contact; not on the form" />
      </div>
      <div className="grid g-2">
        <Card title="Role"><HBars rows={rows(countBy(leads, (l) => l.role))} /></Card>
        <Card title="Firm size"><HBars color="var(--s-2)" rows={rows(countBy(leads, (l) => l.firmSize ?? "Unknown"))} /></Card>
        <Card title="State"><HBars color="var(--s-3)" rows={rows(countBy(leads, (l) => l.state))} /></Card>
        <Card title="City"><HBars color="var(--s-3)" rows={rows(countBy(leads, (l) => l.city))} /></Card>
        <Card title="Practice area"><HBars color="var(--s-4)" rows={rows(countBy(leads, (l) => l.practiceArea ?? "Unknown"))} /></Card>
        <Card title="Email type"><HBars color="var(--s-5)" rows={rows(countBy(leads, (l) => (l.personalEmail ? "Personal" : "Work")))} /></Card>
      </div>
    </>
  );
}
