import Link from "next/link";
import { pageCtx } from "@/lib/data/context";
import { can } from "@/lib/auth/roles";
import { fmtDateTime, relTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { CsvImportButton } from "./_components/client-actions";
import { StatusChip } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { DataTable } from "@/components/ui/data-table";
import { CATEGORIES, STATUS_ORDER, metaFor, statusLabel } from "./_components/meta";
import { IntegrationGrid, type GridItem } from "./_components/integration-grid";
import type { SyncRun } from "@/lib/data/types";
import { vocabFor } from "@/lib/vertical";

export const metadata = { title: "Integrations" };
/** Sample runs are simulated: neutral, never green. Only a real CSV import would read "Success". */
const RUN_TONE = { success: "not_configured", partial: "needs_attention", failed: "error" } as const;
const RUN_LABEL = { success: "Simulated", partial: "Simulated · partial", failed: "Simulated · failed" } as const;

export default async function Integrations() {
  const { ds, now, role, support, active } = await pageCtx();
  const v = vocabFor(active.tenant);
  const [integrations, runs] = await Promise.all([ds.integrations(), ds.syncRuns()]);
  const dayAgo = new Date(now).getTime() - 24 * 3600e3;
  const items: GridItem[] = [...integrations]
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || Number(!!metaFor(b, v).featured) - Number(!!metaFor(a, v).featured))
    .map((i) => {
      const m = metaFor(i, v), s = statusLabel(i);
      const recent = runs.filter((r) => r.integrationId === i.id && new Date(r.startedAt).getTime() >= dayAgo);
      return {
        id: i.id, name: i.name, vendor: i.vendor, category: i.category, monogram: i.monogram, featured: !!m.featured, direction: m.direction,
        status: s.status, statusLabel: s.label, value: m.value || i.summary, trigger: m.trigger.kind,
        lastSync: i.lastSyncAt ? relTime(i.lastSyncAt, now) : null, rows24h: recent.length ? recent.reduce((a, r) => a + r.rowsIn, 0) : null,
      };
    });
  // Featured order follows the demo story, not the alphabet.
  const FEATURED_ORDER = ["whatsapp", "zoho-crm", "linkedin", "mailchimp", "ga4"];
  items.sort((a, b) => (a.featured && b.featured ? FEATURED_ORDER.indexOf(a.id) - FEATURED_ORDER.indexOf(b.id) : 0));

  const live = integrations.filter((i) => i.status === "connected").length;
  const showcase = integrations.filter((i) => i.status === "showcase").length;
  const notConf = integrations.filter((i) => i.status === "not_configured").length;
  const failed24 = runs.filter((r) => r.status === "failed" && new Date(r.startedAt).getTime() >= dayAgo).length;
  const name = (id: string) => integrations.find((i) => i.id === id)?.name ?? id;
  const csvAllowed = can("importCsv", { role, support });

  return (
    <>
      <PageHeader eyebrow="Admin · data sources" title="Integrations"
        sub="What each platform would send and receive, how it connects, and what it needs from you. Nothing here is connected in this deployment; sample data imitates three sources."
        actions={csvAllowed ? <CsvImportButton /> : undefined} />

      <dl className="mb-6 grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface shadow-1 md:grid-cols-4">
        {[
          ["Connected", String(live), "No live vendor connections"],
          ["Showcase", String(showcase), "Described and mapped, not wired"],
          ["Not connected", String(notConf), "Not set up"],
          ["CSV import", "Live", "The one inbound path that works today"],
        ].map(([k, v, s]) => (
          <div key={k} className="-mb-px -mr-px border-b border-r border-line p-4">
            <dt className="text-[12px] font-medium text-ink-2">{k}</dt>
            <dd className="mt-1 text-[22px] font-semibold leading-7 num text-ink">{v}</dd>
            <dd className="mt-0.5 text-[12px] text-ink-3">{s}</dd>
          </div>
        ))}
      </dl>

      <IntegrationGrid items={items} categories={CATEGORIES} />

      <Card className="mt-6">
        <CardHeader title="Recent sync runs" sub={<>Last 10 runs across connectors; full history on Data health. These are sample runs, generated with the demo data{failed24 ? `; ${failed24} failed in the last 24 h` : ""}.</>}
          action={<StatusChip status="sample" />} />
        <DataTable<SyncRun>
          rows={runs.slice(0, 10)} rowKey={(r) => r.id} minWidth={760} caption="Recent sync runs"
          columns={[
            { key: "src", header: "Connector", mobile: "title", cell: (r) => <Link href={`/integrations/${r.integrationId}`} className="font-medium hover:text-accent">{name(r.integrationId)}</Link> },
            { key: "at", header: "Started", mobile: "fact", cell: (r) => <span className="num" title={fmtDateTime(r.startedAt) + " IST"}>{relTime(r.startedAt, now)}</span> },
            { key: "st", header: "Status", mobile: "action", cell: (r) => <StatusChip status={RUN_TONE[r.status]} label={RUN_LABEL[r.status]} /> },
            { key: "dur", header: "Duration", align: "right", cell: (r) => `${r.durationSecs}s` },
            { key: "in", header: "Rows in", align: "right", mobile: "fact", cell: (r) => <>{r.rowsIn}<span className="md:hidden"> rows</span></> },
            { key: "rej", header: "Rejected", align: "right", cell: (r) => <span className={r.rowsRejected ? "text-warn-ink" : "text-ink-3"}>{r.rowsRejected}</span> },
            { key: "note", header: "Note", cell: (r) => <span className={r.status === "failed" ? "text-danger" : "text-ink-2"}>{r.note}</span> },
          ]} />
      </Card>
    </>
  );
}
