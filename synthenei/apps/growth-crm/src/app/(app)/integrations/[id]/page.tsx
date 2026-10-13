import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, CircleAlert, ShieldOff } from "lucide-react";
import { pageCtx, maskName } from "@/lib/data/context";
import { fmtDateTime, inr, relTime } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusChip } from "@/components/ui/badge";
import { Dl, PageHeader } from "@/components/ui/misc";
import { DataTable } from "@/components/ui/data-table";
import { metaFor, statusLabel } from "../_components/meta";
import { DirectionTag, Monogram } from "../_components/bits";
import { FlowDiagram } from "../_components/flow-diagram";
import { ConnectButton, RunSyncButton } from "../_components/client-actions";
import type { SyncRun } from "@/lib/data/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Integration · ${id}` };
}
/** Sample runs are simulated: neutral, never green. Only a real CSV import would read "Success". */
const RUN_TONE = { success: "not_configured", partial: "needs_attention", failed: "error" } as const;
const RUN_LABEL = { success: "Simulated", partial: "Simulated · partial", failed: "Simulated · failed" } as const;
const WHO_TONE = { Client: "warn", Vendor: "outline", Us: "accent" } as const;
/** Fields the CRM owns in a two-way sync (spec 7.2 conflict policy). */
const CRM_OWNED = /stage|value|amount|owner|score|plan/i;
/** Steps that need the client's account access; everything else is our setup work. */
const CLIENT_STEP = /^(verify|approve|authorise|grant|register|request|connect|install|link|admin|workspace admin|entra|each rep|rep connects|create (a|an) (service|api|webhook))/i;

export default async function IntegrationDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ds, now, masked } = await pageCtx();
  const it = await ds.integration(id);
  if (!it) notFound();
  const [runs, leads, accounts, deals, campaigns] = await Promise.all([ds.syncRuns(), ds.leads(), ds.accounts(), ds.deals(), ds.campaigns()]);
  const m = metaFor(it), s = statusLabel(it);
  const myRuns = runs.filter((r) => r.integrationId === it.id).slice(0, 50);

  // Sample value per mapped column, taken from this workspace's sample rows (masked for Viewer).
  const L = leads[0], A = accounts[0], D = deals[0], C = campaigns[0];
  const sample = (target: string): string => {
    const t = target.toLowerCase();
    if (t.startsWith("leads.name")) return L ? (masked ? maskName(L.name) : L.name) : "–";
    if (t.startsWith("leads.phone")) return L ? L.phone.replace(/\d(?=\d{2})/g, "•") : "–";
    if (t.startsWith("leads.email") || t === "email_address") return L ? L.email.replace(/^(.).*(@.*)$/, "$1•••$2") : "–";
    if (t.startsWith("leads.title")) return L?.title ?? "–";
    if (t.startsWith("leads.city")) return L?.city ?? "–";
    if (t.startsWith("leads.stage") || t === "tags[]") return L?.stage ?? "–";
    if (t.startsWith("leads.channel")) return L?.channel ?? "–";
    if (t.startsWith("accounts.name")) return A?.name ?? "–";
    if (t.startsWith("accounts.arr")) return A ? inr(A.arr) : "–";
    if (t.startsWith("deals.value")) return D ? inr(D.value) : "–";
    if (t.startsWith("deals.plan")) return D?.plan ?? "–";
    if (t.startsWith("campaigns.utm") || t.startsWith("campaigns.name")) return C?.utmCampaign ?? "–";
    if (t.startsWith("campaign_daily_metrics.spend")) return "₹4,812";
    if (t.startsWith("ga4_daily.sessions")) return "312";
    if (t.startsWith("ga4_daily.channel")) return "Paid Social";
    if (t.startsWith("messages.status")) return "delivered";
    return "–";
  };
  const flows = [
    ...it.inbound.map((o) => ({ o, dir: "in" as const })),
    ...it.outbound.map((o) => ({ o, dir: "out" as const })),
  ];
  const crmSync = m.direction === "both" && it.category === "CRM";

  return (
    <>
      <Link href="/integrations" className="mb-3 inline-flex items-center gap-1 text-[12px] font-medium text-ink-3 hover:text-ink"><ArrowLeft className="size-3.5" aria-hidden />All integrations</Link>
      <PageHeader eyebrow={`${it.category} · ${it.vendor}`}
        title={<span className="flex items-center gap-3"><Monogram text={it.monogram} size={40} /><span className="min-w-0">{it.name}</span></span>}
        actions={<><RunSyncButton id={it.id} csv={m.csv} /><ConnectButton id={it.id} name={it.name} blockers={m.blockers.filter((b) => b.who !== "Us").map((b) => b.label)} /></>}>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusChip status={s.status} label={s.label} />
          <DirectionTag direction={m.direction} />
          <span className="text-[12px] text-ink-2">{m.trigger.kind}</span>
          <span className="text-[12px] text-ink-3">MVP: described and mapped, not wired</span>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          {m.blockers.length > 0 && (
            <section aria-labelledby="blockers" className="rounded-md border border-warn/40 bg-warn-soft/60 p-4 sm:p-5">
              <h2 id="blockers" className="flex items-center gap-2 text-[14px] font-semibold text-ink"><CircleAlert className="size-4 text-warn-ink" aria-hidden />What stands between this and live</h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {m.blockers.map((b) => (
                  <li key={b.label} className="min-w-0 rounded-sm border border-line bg-surface p-3">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-medium text-ink">{b.label}</span><Badge tone={WHO_TONE[b.who]}>{b.who === "Us" ? "On us" : b.who}</Badge></div>
                    <p className="mt-1 text-[12px] leading-[18px] text-ink-2">{b.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Card>
            <CardHeader title="What flows" sub={m.trigger.detail} />
            <DataTable rows={flows} rowKey={(f) => f.dir + f.o} minWidth={560} caption="What flows"
              columns={[
                { key: "o", header: "Object", mobile: "title", cell: (f) => <span className="whitespace-normal">{f.o}</span> },
                { key: "d", header: "Direction", mobile: "fact", cell: (f) => (
                  <span className="inline-flex items-center gap-1 text-[12px] text-ink-2">
                    {f.dir === "in" ? <><ArrowDownLeft className="size-3.5 text-accent" aria-hidden />In</> : <><ArrowUpRight className="size-3.5 text-ink-3" aria-hidden />Out</>}
                  </span>) },
                { key: "t", header: "Trigger", mobile: "fact", cell: (f) => <span className="text-ink-2">{f.dir === "in" ? m.trigger.kind : "On our change"}</span> },
                { key: "tb", header: "Our table", cell: (f) => <span className="font-mono text-[12px] text-ink-2">{f.dir === "in" ? m.tables.slice(0, 2).join(", ") : `${m.tables[0]?.replace(/^reads /, "") ?? "–"} (read)`}</span> },
              ]} />
          </Card>

          <Card>
            <CardHeader title="Connect steps" sub="In order. Each step names who does it." />
            <CardBody>
              <ol className="flex flex-col gap-0">
                {it.steps.map((step, i) => (
                  <li key={step} className="grid grid-cols-[28px_1fr] gap-3 pb-4 last:pb-0">
                    <span className="relative flex flex-col items-center">
                      <span className="grid size-7 place-items-center rounded-full border border-line-strong bg-surface text-[12px] font-semibold num text-ink">{i + 1}</span>
                      {i < it.steps.length - 1 && <span className="mt-1 w-px flex-1 bg-line" aria-hidden />}
                    </span>
                    <div className="min-w-0 pt-1">
                      <p className="text-[13px] text-ink">{step}</p>
                      <p className="mt-0.5 text-[12px] text-ink-3">{CLIENT_STEP.test(step) ? "Client admin, with us" : "Us"}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Field mapping" sub="Their field to our column. Sample values come from this workspace's sample data; personal data is masked." action={<span className="font-mono text-[10px] text-ink-3">integration_field_maps</span>} />
            <DataTable rows={it.fieldMap.map((f, i) => ({ ...f, i }))} rowKey={(r) => String(r.i)} minWidth={600} caption="Field mapping"
              columns={[
                { key: "src", header: "Their field", mobile: "title", cell: (r) => <span className="font-mono text-[12px]">{r.source}</span> },
                                { key: "tgt", header: "→ CRM table.column", mobile: "fact", cell: (r) => <span className="whitespace-normal break-words font-mono text-[12px] text-accent-strong">{r.target}</span> },
                { key: "tf", header: "Transform", cell: (r) => <span className="text-ink-2">{r.note ?? "none"}</span> },
                { key: "own", header: "Wins on conflict", cell: (r) => <span className="text-ink-2">{crmSync ? (CRM_OWNED.test(r.target) ? "CRM" : "Last write") : "Source system"}</span> },
                { key: "smp", header: "Sample value", mobile: "fact", cell: (r) => <span className="text-ink-2">{sample(r.target)}</span> },
              ]} />
          </Card>

          <Card>
            <CardHeader title="Sync log" sub={myRuns.length ? `Last ${myRuns.length} runs. Sample runs generated with the demo data.` : "No runs. A showcase connector does not sync until it is connected."} action={myRuns.length ? <StatusChip status="sample" /> : undefined} />
            {myRuns.length > 0 && (
              <DataTable<SyncRun> rows={myRuns.slice(0, 12)} rowKey={(r) => r.id} minWidth={640} caption="Sync log"
                columns={[
                  { key: "at", header: "Started", mobile: "title", cell: (r) => <span className="num">{fmtDateTime(r.startedAt)}</span> },
                  { key: "st", header: "Status", mobile: "action", cell: (r) => <StatusChip status={RUN_TONE[r.status]} label={RUN_LABEL[r.status]} /> },
                  { key: "dur", header: "Duration", align: "right", cell: (r) => `${r.durationSecs}s` },
                  { key: "in", header: "Rows in", align: "right", mobile: "fact", cell: (r) => <>{r.rowsIn}<span className="md:hidden"> in</span></> },
                  { key: "rej", header: "Rejected", align: "right", mobile: "fact", cell: (r) => <span className={r.rowsRejected ? "text-warn-ink" : "text-ink-3"}>{r.rowsRejected}<span className="md:hidden"> rejected</span></span> },
                  { key: "n", header: "Note", cell: (r) => <span className={r.status === "failed" ? "text-danger" : "text-ink-2"}>{r.note}</span> },
                ]} />
            )}
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <Card>
            <CardHeader title="Flow" sub="Where data enters, where it lands" />
            <CardBody className="flex justify-center"><FlowDiagram source={m.flow.source} ingest={m.flow.ingest} outbound={m.flow.outbound} direction={m.direction} trigger={m.trigger.kind} tables={m.tables} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Status" />
            <CardBody>
              <Dl items={[
                ["State", <StatusChip key="s" status={s.status} label={s.label} />],
                ["Last sync", it.lastSyncAt ? <span key="l" className="num">{relTime(it.lastSyncAt, now)} (sample)</span> : "Never"],
                ["Auth", <span key="a" className="text-ink-2">{m.auth}</span>],
                ["Tables", <span key="t" className="font-mono text-[12px] text-ink-2">{m.tables.join(", ")}</span>],
                ["Secrets", <span key="x" className="text-ink-2">Server vault only, referenced by name</span>],
              ]} />
            </CardBody>
          </Card>
          {m.neverStore.length > 0 && (
            <Card>
              <CardHeader title="What we never store" />
              <CardBody>
                <ul className="flex flex-col gap-2">
                  {m.neverStore.map((n) => <li key={n} className="flex items-start gap-2 text-[13px] text-ink-2"><ShieldOff className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />{n}</li>)}
                </ul>
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
