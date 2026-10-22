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
import { vocabFor } from "@/lib/vertical";
import { segLeads, type SegLead } from "../campaigns/_lib/marketing";
import { SegmentBuilder } from "./_components/segment-builder";

export const metadata = { title: "Audience" };
const SIZE_ORDER = ["Solo", "2–5", "6–20", "21–50", "50+"];

type Seg = { id: string; name: string; rule: string; test: (l: SegLead) => boolean };

export default async function Audience() {
  const { ds, now, active } = await pageCtx();
  const v = vocabFor(active.tenant), a = v.au, hosp = v.id === "hospitality";
  const [leads, accounts, campaigns] = await Promise.all([ds.leads(), ds.accounts(), ds.campaigns()]);
  const seg = segLeads(leads, accounts, now, hosp);
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const n = seg.length;

  // M15 ICP match: decision-maker role, firm of 2+ lawyers, Tamil Nadu district (spec 5 /audience default ICP).
  const icp = leads.filter((l) => (hosp ? !!l.stay && l.stay.origin !== "new" : icpMatch(l, acc.get(l.accountId))));
  const icpIds = new Set(icp.map((l) => l.id));
  const non = leads.filter((l) => !icpIds.has(l.id));
  const conv = (l: (typeof leads)[number]) => (hosp ? l.stage === "won" : isDemo(l));
  const icpDemo = ratio(icp.filter(conv).length, icp.length), nonDemo = ratio(non.filter(conv).length, non.length);

  const agg = (key: (l: SegLead) => string) => {
    const m = new Map<string, { n: number; demos: number }>();
    seg.forEach((l) => { const k = key(l); const r = m.get(k) ?? { n: 0, demos: 0 }; r.n++; if (l.demo) r.demos++; m.set(k, r); });
    return m;
  };
  const dist = agg((l) => l.district);
  const districtRows = [...dist.entries()].sort((a, b) => b[1].n - a[1].n).map(([label, r]) => ({ label, value: r.n, note: `${r.demos} ${a.demosWord} · ${pct(r.demos / r.n, 0)} ${a.convWord}${r.n < 20 ? " (low n)" : ""}` }));
  const topDistrict = districtRows[0];
  const size = agg((l) => l.size);
  const sizeRows = [...SIZE_ORDER, "Unknown"].filter((s) => size.has(s)).map((s) => ({ label: s === "Unknown" ? s : v.partySize[s as keyof typeof v.partySize], value: size.get(s)!.n, note: `${pct(size.get(s)!.demos / size.get(s)!.n, 0)} ${a.convWord}` }));
  const role = agg((l) => l.title);
  const roleRows = [...role.entries()].sort((a, b) => b[1].n - a[1].n).map(([label, r]) => ({ label, value: r.n, note: `${pct(r.demos / r.n, 0)} ${a.convWord}` }));
  const prac = [...agg((l) => l.practice).entries()].sort((a, b) => b[1].n - a[1].n);
  const pracRows = [...prac.slice(0, 4).map(([label, r]) => ({ key: label, label, n: r.n })), ...(prac.length > 4 ? [{ key: "other", label: a.pracOther(prac.length - 4), n: prac.slice(4).reduce((a, [, r]) => a + r.n, 0) }] : [])];

  const tests: Record<string, (l: SegLead) => boolean> = {
    "chn-hc": (l) => l.district === "Chennai" && l.highCourt && ICP_TITLES.includes(l.title),
    kongu: (l) => (l.district === "Coimbatore" || l.district === "Salem") && (l.size === "6–20" || l.size === "21–50"),
    south: (l) => ["Madurai", "Tirunelveli", "Tiruchirappalli"].includes(l.district) && l.highCourt,
    small: (l) => l.size === "Solo" || l.size === "2–5",
    ops: (l) => l.title === "Practice Manager" || l.title === "Office Manager",
    "chn-wk": (l) => l.district === "Chennai" && ["Couples", "Friends group"].includes(l.practice),
    "blr-fam": (l) => ["Bengaluru", "Coimbatore"].includes(l.district) && l.practice === "Family",
    repeat: (l) => l.title === "Repeat guest",
    big: (l) => ["6–20", "21–50", "50+"].includes(l.size),
    work: (l) => ["Workation", "Corporate retreat"].includes(l.practice),
  };
  const segments: Seg[] = a.segments.map((x) => ({ ...x, test: tests[x.id] }));
  const segRows = segments.map((s) => {
    const xs = seg.filter(s.test), closed = xs.filter((l) => l.closed).length;
    return { ...s, size: xs.length, recent: xs.filter((l) => l.recent).length, l2d: ratio(xs.filter((l) => l.demo).length, xs.length), win: ratio(xs.filter((l) => l.won).length, closed), closed };
  });
  const segCols: Column<(typeof segRows)[number]>[] = [
    { key: "name", header: "Segment", mobile: "title", cell: (s) => <div className="min-w-0"><div className="truncate font-medium text-ink">{s.name}</div><div className="hidden truncate text-[11px] text-ink-3 md:block">{s.rule}</div></div> },
    { key: "size", header: a.colLeads, align: "right", mobile: "fact", cell: (s) => <span>{s.size}<span className="md:hidden">{a.mobileLeads}</span></span> },
    { key: "recent", header: a.colLeads30, align: "right", cell: (s) => s.recent },
    { key: "l2d", header: a.colConv, align: "right", mobile: "fact", cell: (s) => <span>{pct(s.l2d, 0)}<span className="md:hidden">{a.mobileConv}</span>{s.size < 20 && <span className="ml-1 text-[10px] text-ink-3">low n</span>}</span> },
    { key: "win", header: "Win rate", align: "right", cell: (s) => <span className={cn(!s.closed && "text-ink-3")}>{s.closed ? pct(s.win, 0) : "–"}{s.closed > 0 && s.closed < 20 && <span className="ml-1 text-[10px] text-ink-3">low n</span>}</span> },
  ];

  const options = {
    district: [...dist.keys()].sort(),
    size: [...SIZE_ORDER, "Unknown"].filter((s) => size.has(s)),
    title: [...role.keys()].sort(),
    practice: prac.map(([k]) => k),
    court: hosp ? [...new Set(seg.map((l) => l.room))].sort() : a.courtOpts,
    channel: [...new Set(seg.map((l) => l.channel))],
  };

  return (
    <>
      <PageHeader eyebrow={a.eyebrow} title="Audience"
        sub={a.sub} />
      <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <StaggerItem className="lg:col-span-5">
          <NavyPanel className="h-full p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[12px] font-medium text-navy-ink-2">{a.icpTitle}</div>
                <div className="mt-1 text-[32px] font-semibold leading-10 tracking-[-0.02em] num">{pct(icp.length / (n || 1), 0)}</div>
                <div className="text-[12px] text-navy-ink-3 num">{a.icpFoot(icp.length, n)}</div>
              </div>
              <span className="font-mono text-[10px] text-navy-ink-3">M15</span>
            </div>
            <ul className="mt-4 space-y-1.5 text-[13px] text-navy-ink-2">
              {a.icpLines.map(([k, t]) => <li key={k}><span className="text-navy-ink-3">{k}</span> {t}</li>)}
            </ul>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-navy-line pt-4 text-[12px]">
              <div><div className="text-navy-ink-3">{a.icpConv}</div><div className="mt-0.5 text-[18px] font-semibold num">{pct(icpDemo, 0)}</div></div>
              <div><div className="text-navy-ink-3">{a.others}</div><div className="mt-0.5 text-[18px] font-semibold text-navy-ink-2 num">{pct(nonDemo, 0)}</div></div>
            </div>
          </NavyPanel>
        </StaggerItem>
        <StaggerItem className="lg:col-span-7">
          <Card className="h-full">
            <CardHeader title={a.distTitle} sub={topDistrict ? a.distSub(topDistrict.label, topDistrict.value, n) : a.distSubNone} action={<span className="font-mono text-[10px] text-ink-3">M54</span>} />
            <CardBody>
              <HBar label={`${a.distAria} ${districtRows.map((r) => `${r.label} ${r.value}`).join(", ")}`} data={districtRows} highlight={topDistrict?.label} labelWidth={112} valueLabel={a.colLeads} />
            </CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title={a.sizeTitle} sub={a.sizeSub} />
            <CardBody><HBar label={`${a.sizeAria} ${sizeRows.map((r) => `${r.label} ${r.value}`).join(", ")}`} data={sizeRows} highlight="all" color="var(--seq-4)" labelWidth={64} valueLabel={a.colLeads} /></CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title={a.pracTitle} sub={a.pracSub} />
            <CardBody><Donut label={`${a.pracAria} ${pracRows.map((r) => `${r.label} ${r.n}`).join(", ")}`} data={pracRows} centerLabel={a.pracCenter} centerValue={num(n)} size={140} /></CardBody>
          </Card>
        </StaggerItem>
        <StaggerItem className="lg:col-span-4">
          <Card className="h-full">
            <CardHeader title={a.roleTitle} sub={a.roleSub} />
            <CardBody><HBar label={`${a.roleAria} ${roleRows.map((r) => `${r.label} ${r.value}`).join(", ")}`} data={roleRows.map((r) => ({ ...r, color: a.roleHi(r.label) ? "var(--chart-1)" : "var(--seq-2)" }))} labelWidth={124} valueLabel={a.colLeads} /></CardBody>
          </Card>
        </StaggerItem>

        <StaggerItem className="lg:col-span-12">
          <Card>
            <CardHeader title="Saved segments" sub={a.segSub} />
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
      <p className="mt-6 text-[11px] text-ink-3"><StatusChip status="sample" className="mr-1.5" />{a.foot}</p>
    </>
  );
}
