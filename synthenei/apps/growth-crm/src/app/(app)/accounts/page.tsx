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
import { COURT_FILTERS, STATUS_LABEL, STATUS_TONE, courtFocus, firmSites, shortCity } from "./_components/firm";
import { verdict } from "./_components/perms";
import { ListActions } from "./_components/account-actions";

export const metadata = { title: "Law firms" };
const SIZES: FirmSize[] = ["Solo", "2–5", "6–20", "21–50", "50+"];
type SP = { q?: string; district?: string; court?: string; size?: string; status?: string; owner?: string; sort?: string };
type Row = Account & { focus: string[]; sites: number; openValue: number; openCount: number; ownerName: string };

export default async function Accounts({ searchParams }: { searchParams: Promise<SP> }) {
  const { ds, now, role, support, session, scope, masked } = await pageCtx();
  const sp = await searchParams;
  const [accounts, allDeals, team, allLeads] = await Promise.all([ds.accounts(), ds.deals(), ds.team(), ds.leads()]);
  const deals = scope.deals(allDeals);
  const leads = scope.leads(allLeads);
  const rep = role === "sales_rep";
  const nameOf = (id: string) => team.find((t) => t.id === id)?.name ?? "Unassigned";

  const rows: Row[] = accounts.map((a) => {
    const open = deals.filter((d) => d.accountId === a.id && d.stage !== "won" && d.stage !== "lost");
    return { ...a, focus: courtFocus(a.courts), sites: firmSites(a).length, openValue: open.reduce((s, d) => s + d.value, 0), openCount: open.length, ownerName: nameOf(a.ownerId) };
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
  const courtOpts = COURT_FILTERS.filter((c) => rows.some((r) => r.focus.includes(c)));
  const owners = [...new Set(accounts.map((a) => a.ownerId))];
  const multi = rows.filter((r) => r.sites >= 2).length;
  const customers = accounts.filter((a) => a.status === "customer");
  const arr = customers.reduce((s, a) => s + a.arr, 0);
  const byDistrict = districts.map((d) => ({ label: d, value: rows.filter((r) => r.district === d).reduce((s, r) => s + r.openValue, 0), note: `${rows.filter((r) => r.district === d && r.openCount).length} firms with open deals` }))
    .filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const leadsByDistrict = districts.map((d) => ({ label: d, value: leads.filter((l) => accounts.find((a) => a.id === l.accountId)?.district === d).length })).sort((a, b) => b.value - a.value);

  const ctx = { role, support, uid: session.uid };
  const cols: Column<Row>[] = [
    { key: "name", header: "Firm", mobile: "title", cell: (r) => (
      <div className="min-w-0">
        <Link href={`/accounts/${r.id}`} className="block truncate font-medium text-ink hover:text-accent">{r.name}</Link>
        <span className="block truncate text-[12px] text-ink-3 md:hidden lg:block">{r.locality}, {shortCity(r.city)}</span>
      </div>
    ), className: "max-w-[200px]" },
    { key: "district", header: "District", mobile: "fact", cell: (r) => r.district },
    { key: "court", header: "Court focus", cell: (r) => (
      <div className="flex items-center gap-1" title={r.courts.join(" · ")}>
        {r.focus.slice(0, 2).map((c) => <Badge key={c} tone={c.includes("HC") || c === "Madurai Bench" ? "accent" : "neutral"}>{c.replace(" courts", "").replace(" Court", "")}</Badge>)}
        {r.focus.length > 2 && <span className="text-[11px] text-ink-3 num">+{r.focus.length - 2}</span>}
      </div>
    ) },
    { key: "areas", header: "Practice", className: "hidden 2xl:table-cell", cell: (r) => <span className="block max-w-[132px] truncate text-[12px] text-ink-2" title={r.practiceAreas.join(", ")}>{r.practiceAreas.join(", ")}</span> },
    { key: "size", header: "Size", cell: (r) => <span className="num text-ink-2">{r.size}</span>, className: "hidden xl:table-cell" },
    { key: "lawyers", header: "Lawyers", align: "right", cell: (r) => num(r.lawyers) },
    { key: "sites", header: "Sites", align: "right", cell: (r) => num(r.sites) },
    { key: "open", header: rep ? "My open deals" : "Open deals", align: "right", mobile: "fact", cell: (r) => r.openValue ? <span title={`${r.openCount} open deal${r.openCount > 1 ? "s" : ""}`}>{inrCompact(r.openValue)}</span> : <span className="text-ink-3">—</span> },
    { key: "owner", header: "Owner", cell: (r) => <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2" title={r.ownerName}><Avatar name={r.ownerName} size={20} />{r.ownerName.split(" ")[0]}</span> },
    { key: "last", header: "Last touch", align: "right", cell: (r) => <span className="text-[12px] text-ink-2">{relTime(r.lastActivityAt, now)}</span> },
    { key: "status", header: "Status", mobile: "action", cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> },
  ];

  return (
    <>
      <PageHeader eyebrow="Accounts" title="Law firms"
        sub={`${accounts.length} firms across ${districts.length} districts. ${customers.length} customers, ${accounts.filter((a) => a.status === "trial").length} on trial.${rep ? " Deal values show your own deals." : ""}${masked ? " Contacts are hidden for your role." : ""}`}
        actions={<ListActions districts={districts} create={verdict("createAccount", ctx)} importV={verdict("importCsv", ctx)} exportV={verdict("exportCsv", ctx)} />} />

      <Stagger className="grid gap-4">
        <StaggerItem className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Kpi label="Firms in workspace" value={accounts.length} foot={<>{rows.filter((r) => r.openCount).length} with open deals</>} />
          <Kpi label={rep ? "My open pipeline" : "Open pipeline"} metric="M34" value={pipelineTotals(deals, now).openValue} format="inrCompact" foot={<>{rows.reduce((s, r) => s + r.openCount, 0)} open deals</>} />
          <Kpi label="Multi-site firms" metric="M55" value={ratio(multi, accounts.length)} format="pct" foot={<>{multi} of {accounts.length} firms have 2+ offices</>} />
          <Kpi label="Customer ARR" value={arr} format="inrCompact" foot={<>{customers.length} customer firm{customers.length === 1 ? "" : "s"}</>} />
        </StaggerItem>

        <StaggerItem>
          <Card>
            <div className="flex flex-col gap-3 px-4 pt-4 pb-3 sm:px-5">
              <FilterBar search="Search firm, city or locality" filters={[
                { key: "district", label: "District", options: districts.map((d) => ({ value: d, label: d })) },
                { key: "court", label: "Court", options: courtOpts.map((c) => ({ value: c, label: c })) },
                { key: "size", label: "Size", options: SIZES.map((s) => ({ value: s, label: s })) },
                { key: "status", label: "Status", options: (["prospect", "trial", "customer", "churned"] as const).map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
                { key: "owner", label: "Owner", options: [...(rep ? [{ value: "me", label: "Mine" }] : []), ...owners.map((o) => ({ value: o, label: nameOf(o) }))] },
                { key: "sort", label: "Sort", options: [{ value: "recent", label: "Last activity" }, { value: "lawyers", label: "Lawyers" }, { value: "name", label: "Name A–Z" }] },
              ]} />
              <p className="text-[12px] text-ink-3 num" aria-live="polite">Showing {filtered.length} of {accounts.length} firms{sp.sort ? "" : ", largest open pipeline first"}</p>
            </div>
            <DataTable rows={filtered} columns={cols} rowKey={(r) => r.id} minWidth={880} caption="Law firms"
              empty="No firms match these filters." emptyHint="Clear a filter, or search by city (for example Madurai)." />
          </Card>
        </StaggerItem>

        <StaggerItem className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Which districts carry the open pipeline?" sub={`Open deal value by firm district${rep ? ", your deals" : ""}`} action={<span className="font-mono text-[10px] text-ink-3">M34 · M54</span>} />
            <CardBody>
              {byDistrict.length ? <BarList rows={byDistrict} format="inrCompact" label="Open pipeline by district" />
                : <p className="py-6 text-center text-[13px] text-ink-3">No open deals yet. Open a deal from a firm's page to see it here.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Where are the leads coming from?" sub={`Leads by firm district${rep ? ", your leads" : ""}`} action={<span className="font-mono text-[10px] text-ink-3">M54</span>} />
            <CardBody><BarList rows={leadsByDistrict} format="num" label="Leads by district" /></CardBody>
            <p className="border-t border-line px-4 py-2.5 text-[12px] text-ink-3 sm:px-5">{pct(ratio(multi, accounts.length), 0)} of firms work from more than one office; they need one shared calendar.</p>
          </Card>
        </StaggerItem>
      </Stagger>
    </>
  );
}
