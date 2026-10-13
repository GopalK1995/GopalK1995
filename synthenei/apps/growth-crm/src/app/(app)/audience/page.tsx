import { pageCtx } from "@/lib/data/context";
import { CHANNEL_LABEL, ICP_TITLES, icpMatch, isDemo } from "@/lib/data/metrics";
import { num, pct, ratio } from "@/lib/format";
import { Card, CardBody, CardHeader, NavyPanel } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { HBar } from "@/components/charts/hbar";
import { Donut } from "@/components/charts/donut";
import { cn } from "@/lib/utils";
import { segLeads, type SegLead } from "../campaigns/_lib/marketing";
import { SegmentBuilder } from "./_components/segment-builder";

export const metadata = { title: "Audience" };
const SIZE_ORDER = ["Solo", "2–5", "6–20", "21–50", "50+"];

type Seg = { id: string; name: string; rule: string; test: (l: SegLead) => boolean };

export default async function Audience() {
  const { ds, now } = await pageCtx();
  const [leads, accounts, campaigns] = await Promise.all([ds.leads(), ds.accounts(), ds.campaigns()]);
  const seg = segLeads(leads, accounts, now);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const n = seg.length;

  // M15 ICP match: decision-maker role, firm of 2+ lawyers, Tamil Nadu district (spec 5 /audience default ICP).
  const icp = leads.filter((l) => icpMatch(l, acc.get(l.accountId)));
  const icpIds = new Set(icp.map((l) => l.id));
  const non = leads.filter((l) => !icpIds.has(l.id));
  const icpDemo = ratio(icp.filter(isDemo).length, icp.length), nonDemo = ratio(non.filter(isDemo).length, non.length);

  const agg = (key: (l: SegLead) => string) => {
    const m = new Map<string, { n: number; demos: number }>();
    seg.forEach((l) => { const k = key(l); const r = m.get(k) ?? { n: 0, demos: 0 }; r.n++; if (l.demo) r.demos++; m.set(k, r); });
    return m;
  };
  const dist = agg((l) => l.district);
  const districtRows = [...dist.entries()].sort((a, b) => b[1].n - a[1].n).map(([label, r]) => ({ label, value: r.n, note: `${r.demos} demos · ${pct(r.demos / r.n, 0)} lead → demo${r.n < 20 ? " (low n)" : ""}` }));
  const topDistrict = districtRows[0];
  const size = agg((l) => l.size);
  const sizeRows = [...SIZE_ORDER, "Unknown"].filter((s) => size.has(s)).map((s) => ({ label: s, value: size.get(s)!.n, note: `${pct(size.get(s)!.demos / size.get(s)!.n, 0)} lead → demo` }));
  const role = agg((l) => l.title);
  const roleRows = [...role.entries()].sort((a, b) => b[1].n - a[1].n).map(([label, r]) => ({ label, value: r.n, note: `${pct(r.demos / r.n, 0)} lead → demo` }));
  const prac = [...agg((l) => l.practice).entries()].sort((a, b) => b[1].n - a[1].n);
  const pracRows = [...prac.slice(0, 4).map(([label, r]) => ({ key: label, label, n: r.n })), ...(prac.length > 4 ? [{ key: "other", label: `Other (${prac.length - 4} areas)`, n: prac.slice(4).reduce((a, [, r]) => a + r.n, 0) }] : [])];

  const segments: Seg[] = [
    { id: "chn-hc", name: "Chennai High Court decision-makers", rule: "District = Chennai AND court = Madras HC AND role in ICP roles", test: (l) => l.district === "Chennai" && l.highCourt && ICP_TITLES.includes(l.title) },
    { id: "kongu", name: "Kongu belt mid-size firms", rule: "District in Coimbatore, Salem AND firm size 6–50", test: (l) => (l.district === "Coimbatore" || l.district === "Salem") && (l.size === "6–20" || l.size === "21–50") },
    { id: "south", name: "Madurai Bench litigators", rule: "District in Madurai, Tirunelveli, Tiruchirappalli AND High Court practice", test: (l) => ["Madurai", "Tirunelveli", "Tiruchirappalli"].includes(l.district) && l.highCourt },
    { id: "small", name: "Solo and small chambers", rule: "Firm size in Solo, 2–5", test: (l) => l.size === "Solo" || l.size === "2–5" },
    { id: "ops", name: "Practice and office managers", rule: "Role in Practice Manager, Office Manager", test: (l) => l.title === "Practice Manager" || l.title === "Office Manager" },
  ];
  const segRows = segments.map((s) => {
    const xs = seg.filter(s.test), closed = xs.filter((l) => l.closed).length;
    return { ...s, size: xs.length, recent: xs.filter((l) => l.recent).length, l2d: ratio(xs.filter((l) => l.demo).length, xs.length), win: ratio(xs.filter((l) => l.won).length, closed), closed };
  });
  const segCols: Column<(typeof segRows)[number]>[] = [
    { key: "name", header: "Segment", mobile: "title", cell: (s) => <div className="min-w-0"><div className="truncate font-medium text-ink">{s.name}</div><div className="hidden truncate text-[11px] text-ink-3 md:block">{s.rule}</div></div> },
    { key: "size", header: "Leads", align: "right", mobile: "fact", cell: (s) => <span>{s.size}<span className="md:hidden"> leads</span></span> },
    { key: "recent", header: "Leads 30 d", align: "right", cell: (s) => s.recent },
    { key: "l2d", header: "Lead → demo", align: "right", mobile: "fact", cell: (s) => <span>{pct(s.l2d, 0)}<span className="md:hidden"> to demo</span>{s.size < 20 && <span className="ml-1 text-[10px] text-ink-3">low n</span>}</span> },
    { key: "win", header: "Win rate", align: "right", cell: (s) => <span className={cn(!s.closed && "text-ink-3")}>{s.closed ? pct(s.win, 0) : "–"}{s.closed > 0 && s.closed < 20 && <span className="ml-1 text-[10px] text-ink-3">low n</span>}</span> },
  ];

  const options = {
    district: [...dist.keys()].sort(),
    size: [...SIZE_ORDER, "Unknown"].filter((s) => size.has(s)),
    title: [...role.keys()].sort(),
    practice: prac.map(([k]) => k),
    court: ["Madras High Court / Madurai Bench", "District courts only"],
    channel: [...new Set(seg.map((l) => l.channel))],
  };

  return (
    <>
      <PageHeader eyebrow="Marketing · all live leads" title="Audience"
        sub="Who our leads are, by district, firm size, practice and role, and which slices turn into demos. Build a segment, then attach it to a campaign." />
      <Stagger className="grid gap-4 lg:grid-cols-12">
        <StaggerItem className="lg:col-span-5">
          <NavyPanel className="h-full p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[12px] font-medium text-navy-ink-2">Ideal customer profile</div>
                <div className="mt-1 text-[32px] font-semibold leading-10 tracking-[-0.02em] num">{pct(icp.length / (n || 1), 0)}</div>
                <div className="text-[12px] text-navy-ink-3 num">{icp.length} of {n} leads match (M15)</div>
              </div>
              <span className="font-mono text-[10px] text-navy-ink-3">M15</span>
            </div>
            <ul className="mt-4 space-y-1.5 text-[13px] text-navy-ink-2">
              <li><span className="text-navy-ink-3">Role:</span> Managing Partner, Senior Advocate, Partner, Founding Advocate</li>
              <li><span className="text-navy-ink-3">Firm:</span> 2 or more lawyers (ICP tier A or B)</li>
              <li><span className="text-navy-ink-3">Contact:</span> work email, Tamil Nadu district</li>
            </ul>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-navy-line pt-4 text-[12px]">
              <div><div className="text-navy-ink-3">ICP lead → demo</div><div className="mt-0.5 text-[18px] font-semibold num">{pct(icpDemo, 0)}</div></div>
              <div><div className="text-navy-ink-3">Everyone else</div><div className="mt-0.5 text-[18px] font-semibold text-navy-ink-2 num">{pct(nonDemo, 0)}</div></div>
            </div>
          </NavyPanel>
        </StaggerItem>
        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title="Which districts bring leads?" sub={topDistrict ? `${topDistrict.label} brings ${topDistrict.value} of ${n} leads. Hover a bar for demos and conversion.` : "Leads by district"} action={<span className="font-mono text-[10px] text-ink-3">M54</span>} />
            <CardBody>
              <HBar label={`Leads by Tamil Nadu district. ${districtRows.map((r) => `${r.label} ${r.value}`).join(", ")}`} data={districtRows} highlight={topDistrict?.label} labelWidth={112} valueLabel="Leads" />
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title="How big are the firms?" sub="Leads by number of lawyers, smallest first" />
            <CardBody><HBar label={`Leads by firm size. ${sizeRows.map((r) => `${r.label} ${r.value}`).join(", ")}`} data={sizeRows} highlight="all" color="var(--seq-4)" labelWidth={64} valueLabel="Leads" /></CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title="What do they practise?" sub="Primary practice area of the lead's firm" />
            <CardBody><Donut label={`Leads by practice area. ${pracRows.map((r) => `${r.label} ${r.n}`).join(", ")}`} data={pracRows} centerLabel="leads" centerValue={num(n)} size={140} /></CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title="Who fills the form?" sub="Leads by role; decision-makers highlighted" />
            <CardBody><HBar label={`Leads by role. ${roleRows.map((r) => `${r.label} ${r.value}`).join(", ")}`} data={roleRows.map((r) => ({ ...r, color: ICP_TITLES.includes(r.label) ? "var(--chart-1)" : "var(--seq-2)" }))} labelWidth={124} valueLabel="Leads" /></CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-12">
          <Card>
            <CardHeader title="Saved segments" sub="Lead → demo and win rate per segment; win rate counts closed deals only" />
            <DataTable rows={segRows} columns={segCols} rowKey={(s) => s.id} minWidth={720} caption="Saved audience segments" />
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-12">
          <Card>
            <CardHeader title="Build a segment" sub="Rules combine with AND; values inside a rule combine with OR" action={<StatusChip status="showcase" label="Showcase: audience push" />} />
            <CardBody>
              <SegmentBuilder leads={seg} options={options} campaigns={campaigns.filter((c) => c.status !== "ended").map((c) => ({ id: c.id, name: c.name, channel: c.channel }))} channelLabel={CHANNEL_LABEL} />
            </CardBody>
          </Card>
        </StaggerItem>
      </Stagger>
      <p className="mt-6 text-[11px] text-ink-3"><StatusChip status="sample" className="mr-1.5" />Synthetic Tamil Nadu firms and leads. Counts only: no names or contact details leave the server on this page.</p>
    </>
  );
}
