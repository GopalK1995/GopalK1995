import Link from "next/link";
import { pageCtx } from "@/lib/data/context";
import { inrCompact, num, pct, ratio, relTime } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Kpi } from "@/components/ui/kpi";
import { PageHeader } from "@/components/ui/misc";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { Avatar } from "@/components/ui/avatar";
import { Stagger, StaggerItem } from "@/components/ui/motion";
import { BarList } from "./_components/bar-list";
import { pipelineTotals } from "@/lib/data/metrics";
import type { Account, FirmSize } from "@/lib/data/types";
import { COURT_FILTERS, STATUS_TONE, courtFocus, firmSites, shortCity } from "./_components/firm";
import { verdict } from "./_components/perms";
import { ListActions } from "./_components/account-actions";
import { vocabFor } from "@/lib/vertical";

export async function generateMetadata() {
  const { active } = await pageCtx();
  return { title: vocabFor(active.tenant).ac.metaTitle };
}
const SIZES: FirmSize[] = ["Solo", "2–5", "6–20", "21–50", "50+"];
type SP = { q?: string; district?: string; court?: string; size?: string; status?: string; owner?: string; sort?: string };
type Row = Account & { focus: string[]; sites: number; openValue: number; openCount: number; ownerName: string };

export default async function Accounts({ searchParams }: { searchParams: Promise<SP> }) {
  const { ds, now, role, support, session, scope, masked, active } = await pageCtx();
  const v = vocabFor(active.tenant), ac = v.ac, hosp = v.id === "hospitality", STATUS_LABEL = ac.status;
  const sp = await searchParams;
  const [accounts, allDeals, team, allLeads] = await Promise.all([ds.accounts(), ds.deals(), ds.team(), ds.leads()]);
  const deals = scope.deals(allDeals);
  const leads = scope.leads(allLeads);
  const rep = role === "sales_rep";
  const nameOf = (id: string) => team.find((t) => t.id === id)?.name ?? "Unassigned";

  const rows: Row[] = accounts.map((a) => {
    const open = deals.filter((d) => d.accountId === a.id && d.stage !== "won" && d.stage !== "lost");
    return { ...a, focus: hosp ? a.roomsOfInterest ?? [] : courtFocus(a.courts), sites: hosp ? a.stays ?? 0 : firmSites(a).length, openValue: open.reduce((s, d) => s + d.value, 0), openCount: open.length, ownerName: nameOf(a.ownerId) };
  });
  const q = (sp.q ?? "").toLowerCase().trim();
  const filtered = rows.filter((r) =>
    (!q || `${r.name} ${r.city} ${r.locality} ${r.district}`.toLowerCase().includes(q)) &&
    (!sp.district || r.district === sp.district) && (!sp.court || r.focus.includes(sp.court)) &&
    (!sp.size || r.size === sp.size) && (!sp.status || r.status === sp.status) && (!sp.owner || r.ownerId === sp.owner || (sp.owner === "me" && r.ownerId === session.uid)));
  const sorters: Record<string, (a: Row, b: Row) => number> = {
    open: (a, b) => b.openValue - a.openValue || b.lastActivityAt.localeCompare(a.lastActivityAt),
    recent: (a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt),
    lawyers: (a, b) => b.lawyers - a.lawyers,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  filtered.sort(sorters[sp.sort ?? "open"] ?? sorters.open);

  const districts = [...new Set(accounts.map((a) => a.district))].sort();
  const courtOpts = (hosp ? [...new Set(rows.flatMap((r) => r.focus))].sort() : COURT_FILTERS).filter((c) => rows.some((r) => r.focus.includes(c)));
  const owners = [...new Set(accounts.map((a) => a.ownerId))];
  const multi = rows.filter((r) => r.sites >= 2).length;
  const customers = accounts.filter((a) => a.status === "customer");
  const arr = (hosp ? accounts : customers).reduce((s, a) => s + a.arr, 0);
  const byDistrict = districts.map((d) => ({ label: d, value: rows.filter((r) => r.district === d).reduce((s, r) => s + r.openValue, 0), note: ac.chartANote(rows.filter((r) => r.district === d && r.openCount).length) }))
    .filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const leadsByDistrict = districts.map((d) => ({ label: d, value: leads.filter((l) => accounts.find((a) => a.id === l.accountId)?.district === d).length })).sort((a, b) => b.value - a.value);

  const ctx = { role, support, uid: session.uid };
  const cols: Column<Row>[] = [
    { key: "name", header: ac.colName, mobile: "title", cell: (r) => (
      <div className="min-w-0">
        <Link href={`/accounts/${r.id}`} className="block truncate font-medium text-ink hover:text-accent">{r.name}</Link>
        <span className="block truncate text-[12px] text-ink-3 md:hidden lg:block">{r.locality}, {shortCity(r.city)}</span>
      </div>
    ), className: "max-w-[200px]" },
    { key: "district", header: ac.colDistrict, mobile: "fact", cell: (r) => r.district },
    { key: "court", header: ac.colCourt, cell: (r) => (
      <div className="flex items-center gap-1" title={(hosp ? r.focus : r.courts).join(" · ")}>
        {r.focus.slice(0, 2).map((c) => <Badge key={c} tone={!hosp && (c.includes("HC") || c === "Madurai Bench") ? "accent" : "neutral"}>{hosp ? c : c.replace(" courts", "").replace(" Court", "")}</Badge>)}
        {r.focus.length > 2 && <span className="text-[11px] text-ink-3 num">+{r.focus.length - 2}</span>}
      </div>
    ) },
    { key: "areas", header: ac.colAreas, className: "hidden 2xl:table-cell", cell: (r) => { const t = (hosp ? r.interests ?? [] : r.practiceAreas).join(", "); return <span className="block max-w-[132px] truncate text-[12px] text-ink-2" title={t}>{t}</span>; } },
    { key: "size", header: ac.colSize, cell: (r) => <span className="num text-ink-2">{v.partySize[r.size]}</span>, className: "hidden xl:table-cell" },
    { key: "lawyers", header: ac.colLawyers, align: "right", cell: (r) => num(r.lawyers) },
    { key: "sites", header: ac.colSites, align: "right", cell: (r) => num(r.sites) },
    { key: "open", header: ac.colOpen(rep), align: "right", mobile: "fact", cell: (r) => r.openValue ? <span title={ac.openTitle(r.openCount)}>{inrCompact(r.openValue)}</span> : <span className="text-ink-3">—</span> },
    { key: "owner", header: "Owner", cell: (r) => <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2" title={r.ownerName}><Avatar name={r.ownerName} size={20} />{r.ownerName.split(" ")[0]}</span> },
    { key: "last", header: "Last touch", align: "right", cell: (r) => <span className="text-[12px] text-ink-2">{relTime(r.lastActivityAt, now)}</span> },
    { key: "status", header: "Status", mobile: "action", cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
  ];

  return (
    <>
      <PageHeader eyebrow={ac.eyebrow} title={ac.title}
        sub={ac.sub(accounts.length, districts.length, customers.length, accounts.filter((a) => a.status === "trial").length, rep, masked)}
        actions={<ListActions owners={team.filter((m) => m.role !== "viewer").map((m) => ({ id: m.id, name: m.name }))} districts={districts} create={verdict("createAccount", ctx)} importV={verdict("importCsv", ctx)} exportV={verdict("exportCsv", ctx)} />} />

      <Stagger className="grid gap-4">
        <StaggerItem className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label={ac.kAll} value={accounts.length} foot={<>{ac.kAllFoot(rows.filter((r) => r.openCount).length)}</>} />
          <Kpi label={hosp ? (rep ? "My open bookings value" : "Open enquiry value") : rep ? "My open pipeline" : "Open pipeline"} metric="M34" value={pipelineTotals(deals, now).openValue} format="inrCompact" foot={<>{ac.kOpenFoot(rows.reduce((s, r) => s + r.openCount, 0))}</>} />
          <Kpi label={ac.kMulti} metric="M55" value={ratio(hosp ? accounts.filter((a) => a.repeatGuest).length : multi, accounts.length)} format="pct" foot={<>{ac.kMultiFoot(hosp ? accounts.filter((a) => a.repeatGuest).length : multi, accounts.length)}</>} />
          <Kpi label={ac.kArr} value={arr} format="inrCompact" foot={<>{ac.kArrFoot(customers.length)}</>} />
        </StaggerItem>

        <StaggerItem>
          <Card>
            <div className="flex flex-col gap-3 px-4 pt-4 pb-3 sm:px-5">
              <FilterBar search={ac.search} filters={[
                { key: "district", label: ac.colDistrict, options: districts.map((d) => ({ value: d, label: d })) },
                { key: "court", label: ac.fCourt, options: courtOpts.map((c) => ({ value: c, label: c })) },
                { key: "size", label: ac.fSize, options: SIZES.map((s) => ({ value: s, label: v.partySize[s] })) },
                { key: "status", label: "Status", options: (["prospect", "trial", "customer", "churned"] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
                { key: "owner", label: "Owner", options: [...(rep ? [{ value: "me", label: "Mine" }] : []), ...owners.map((o) => ({ value: o, label: nameOf(o) }))] },
                { key: "sort", label: "Sort", options: [{ value: "recent", label: "Last activity" }, { value: "lawyers", label: ac.sortLawyers }, { value: "name", label: "Name A–Z" }] },
              ]} />
              <p className="text-[12px] text-ink-3 num" aria-live="polite">{ac.showing(filtered.length, accounts.length, !!sp.sort)}</p>
            </div>
            <DataTable rows={filtered} columns={cols} rowKey={(r) => r.id} minWidth={880} caption={ac.caption}
              empty={ac.empty} emptyHint={ac.emptyHint} />
          </Card>
        </StaggerItem>

        <StaggerItem className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title={ac.chartA} sub={ac.chartASub(rep)} action={<span className="font-mono text-[10px] text-ink-3">M34 · M54</span>} />
            <CardBody>
              {byDistrict.length ? <BarList rows={byDistrict} format="inrCompact" label={ac.chartAria} />
                : <p className="py-6 text-center text-[13px] text-ink-3">{ac.chartAEmpty}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={ac.chartB} sub={ac.chartBSub(rep)} action={<span className="font-mono text-[10px] text-ink-3">M54</span>} />
            <CardBody><BarList rows={leadsByDistrict} format="num" label={ac.chartBAria} /></CardBody>
            <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-3 sm:px-5">{ac.chartBFoot(pct(ratio(hosp ? accounts.filter((a) => a.repeatGuest).length : multi, accounts.length), 0))}</p>
          </Card>
        </StaggerItem>
      </Stagger>
    </>
  );
}
