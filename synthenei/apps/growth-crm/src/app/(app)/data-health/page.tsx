import Link from "next/link";
import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import { getBackupAdapter } from "@/lib/data/backup";
import { fmtDateTime, fmtDateY, num, relTime } from "@/lib/format";
import { Card, CardBody, CardHeader, NavyPanel } from "@/components/ui/card";
import { Badge, StatusChip } from "@/components/ui/badge";
import { PageHeader, Meter } from "@/components/ui/misc";
import { DataTable } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import { LogDrillButton, RuleToggle, RunCheckButton } from "./_components/controls";
import type { SyncRun } from "@/lib/data/types";

export const metadata = { title: "Data health" };
const H = 3600e3, D = 24 * H;
/** Sample runs are simulated: neutral, never green. Only a real CSV import would read "Success". */
const RUN_TONE = { success: "not_configured", partial: "needs_attention", failed: "error" } as const;
const RUN_LABEL = { success: "Simulated", partial: "Simulated · partial", failed: "Simulated · failed" } as const;
/** Planned offsite retention per tenant plan (spec 8: 30 days baseline). Supabase-managed daily backups keep 7 days on Free/Pro. */
const RETENTION: Record<string, { offsite: number; note: string }> = {
  Pilot: { offsite: 14, note: "Pilot plan" },
  Growth: { offsite: 30, note: "Growth plan" },
  Scale: { offsite: 90, note: "Scale plan, PITR add-on available" },
};
const bytes = (n: number | null) => (n === null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const hrs = (ms: number) => (ms < D ? `${Math.round(ms / H)} h` : `${Math.round(ms / D)} d`);

export default async function DataHealth() {
  const { ds, now, active } = await pageCtx();
  const [snap, runs, integrations, leads, activities, campaigns, days, deals, accounts, tasks, consent, ga4] = await Promise.all([
    getBackupAdapter(active.ws).getSnapshot(), ds.syncRuns(), ds.integrations(), ds.leads(), ds.activities(), ds.campaigns(), ds.campaignDays(),
    ds.deals(), ds.accounts(), ds.tasks(), ds.consent(), ds.ga4(),
  ]);
  const nowMs = new Date(now).getTime();
  const dump = snap.checks.find((c) => c.kind === "logical_dump");
  const daily = snap.checks.find((c) => c.kind === "supabase_daily");
  const drill = snap.checks.find((c) => c.kind === "restore_drill");
  const ageMs = dump?.takenAt ? nowMs - new Date(dump.takenAt).getTime() : Infinity;
  const stale = ageMs > snap.staleAfterHours * H;
  const drillDays = drill?.takenAt ? Math.round((nowMs - new Date(drill.takenAt).getTime()) / D) : null;
  const retention = RETENTION[active.tenant.plan] ?? RETENTION.Growth;

  // Row counts: this workspace's tables now; "at last dump" applies the adapter's per-table change since the dump.
  const current: Record<string, number> = {
    leads: leads.length, activities: activities.length, campaigns: campaigns.length, campaign_daily_metrics: days.length, ga4_daily: ga4.days.length,
    deals: deals.length, accounts: accounts.length, tasks: tasks.length, consent_log: consent.length,
  };
  const counts = snap.tableCounts.map((t) => {
    const cur = current[t.table] ?? t.current, atDump = Math.max(0, cur - (t.current - t.atLastDump));
    const change = atDump ? (cur - atDump) / atDump : 0;
    return { table: t.table, cur, atDump, change, flag: change < -0.05 };
  });

  // Freshness: hours since last successful sample sync per connector that has runs.
  const fresh = integrations.map((i) => {
    const ok = runs.find((r) => r.integrationId === i.id && r.status !== "failed");
    const lastFail = runs.find((r) => r.integrationId === i.id)?.status === "failed";
    return { id: i.id, name: i.name, ageH: ok ? (nowMs - new Date(ok.startedAt).getTime()) / H : null, lastFail };
  }).filter((f) => f.ageH !== null).sort((a, b) => (b.ageH ?? 0) - (a.ageH ?? 0));
  const name = (id: string) => integrations.find((i) => i.id === id)?.name ?? id;

  return (
    <>
      <PageHeader eyebrow="Admin · backups and sync" title="Data health"
        sub="Is the data fresh, complete and backed up? Supabase has no API for backup status, so our nightly dump job writes a heartbeat row that this page reads."
        actions={<><LogDrillButton /><RunCheckButton /></>} />

      <p role="note" className="mb-4 flex items-start gap-2 rounded-sm border border-dashed border-ink-3/50 bg-surface px-3 py-2 text-[12px] leading-[18px] text-ink-2">
        <Info className="mt-px size-4 shrink-0 text-ink-3" aria-hidden />
        <span><span className="font-medium text-ink">Sample values.</span> The nightly dump job is designed, not running yet. Tiles show what the heartbeat will report; the first real backup record is shown before go-live.</span>
      </p>

      <div className="grid gap-4 lg:grid-cols-12">
        <NavyPanel className="p-5 lg:col-span-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12px] font-medium text-navy-ink-2">Nightly offsite dump · heartbeat</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-[32px] font-semibold leading-9 num">{Number.isFinite(ageMs) ? hrs(ageMs) : "never"}</span>
                <span className="text-[13px] text-navy-ink-2">since last dump</span>
              </div>
            </div>
            <span className={cn("inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium", stale ? "bg-danger text-white" : "bg-navy-800 text-navy-ink")}>
              {stale ? <CircleX className="size-3" aria-hidden /> : <CircleCheck className="size-3 text-[oklch(0.8_0.12_155)]" aria-hidden />}{stale ? "Stale" : "Within threshold"}
            </span>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[11px] text-navy-ink-3 num"><span>0 h</span><span>alert at {snap.staleAfterHours} h</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-navy-800" role="meter" aria-valuemin={0} aria-valuemax={snap.staleAfterHours} aria-valuenow={Math.min(snap.staleAfterHours, Math.round(ageMs / H))} aria-label="Hours since last dump">
              <div className={cn("h-full rounded-full", stale ? "bg-danger" : "bg-accent-on-navy")} style={{ width: `${Math.min(100, (ageMs / (snap.staleAfterHours * H)) * 100)}%` }} />
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-navy-line pt-4 text-[12px]">
            <div><dt className="text-navy-ink-3">Taken</dt><dd className="mt-0.5 num">{dump?.takenAt ? `${fmtDateTime(dump.takenAt)} IST` : "–"}</dd></div>
            <div><dt className="text-navy-ink-3">Size</dt><dd className="mt-0.5 num">{bytes(dump?.sizeBytes ?? null)}</dd></div>
            <div><dt className="text-navy-ink-3">Offsite location</dt><dd className="mt-0.5">Offsite bucket (provider not chosen)</dd></div>
            <div><dt className="text-navy-ink-3">Schedule</dt><dd className="mt-0.5">02:00 IST, encrypted at rest</dd></div>
          </dl>
        </NavyPanel>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
          <Tile label="Retention" value={`${retention.offsite} days`} foot={<>Offsite dumps, {retention.note} (planned). Supabase daily backups: {snap.retentionDays ?? "–"} days.</>} />
          <Tile label="Point-in-time recovery" value={snap.pitrEnabled ? "On" : "Off"} tone={snap.pitrEnabled ? undefined : "warn"} foot="Paid Supabase add-on. Without it, the worst case loses up to a day of changes." />
          <Tile label="Supabase daily backup (sample)" value={daily?.takenAt ? relTime(daily.takenAt, now) : "–"} foot={<>Plan fact: Pro keeps daily backups 7 days. Size {bytes(daily?.sizeBytes ?? null)} is a sample; the project plan is not confirmed. Excludes Storage and Edge Functions.</>} />
          <Tile label="Last restore drill" value={drillDays !== null ? `${drillDays} days ago` : "Never"} tone={drillDays !== null && drillDays > 90 ? "danger" : undefined}
            foot={<>Target: every 90 days or sooner (M26). <Meter value={drillDays ?? 90} max={90} tone={drillDays !== null && drillDays > 75 ? "warn" : "accent"} className="mt-2" /></>} />
        </div>

        <Card className="lg:col-span-7">
          <CardHeader title="Row counts vs last dump" sub="A table that shrank more than 5% since the dump is flagged (M25)." />
          <DataTable rows={counts} rowKey={(r) => r.table} minWidth={520} caption="Row counts per table"
            columns={[
              { key: "t", header: "Table", mobile: "title", cell: (r) => <span className="font-mono text-[12px]">{r.table}</span> },
              { key: "d", header: "At last dump", align: "right", cell: (r) => num(r.atDump) },
              { key: "c", header: "Now", align: "right", mobile: "fact", cell: (r) => <>{num(r.cur)}<span className="md:hidden"> rows</span></> },
              { key: "x", header: "Change", align: "right", mobile: "action", cell: (r) => (
                <span className={cn("num", r.flag ? "font-medium text-danger" : r.change > 0 ? "text-ink-2" : "text-ink-3")}>
                  {r.flag && <CircleAlert className="mr-1 inline size-3.5 align-[-2px]" aria-label="Flagged" />}{r.change > 0 ? "+" : ""}{(r.change * 100).toFixed(1)}%
                </span>) },
            ]} />
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader title="Sync freshness" sub="Hours since the last good run per connector (M27). Sample runs." />
          <CardBody>
            <ul className="flex flex-col divide-y divide-line">
              {fresh.map((f) => (
                <li key={f.id} className="flex items-center gap-3 py-2 first:pt-0">
                  <span className={cn("size-2 shrink-0 rounded-full", f.lastFail ? "bg-danger" : (f.ageH ?? 0) > 26 ? "bg-warn" : "bg-success")} aria-hidden />
                  <Link href={`/integrations/${f.id}`} className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink hover:text-accent">{f.name}</Link>
                  <span className={cn("text-right text-[12px] num", f.lastFail ? "text-danger" : "text-ink-2")}>{f.lastFail ? "Last run failed · " : ""}{(f.ageH ?? 0) < 1 ? "under 1 h" : `${Math.round(f.ageH ?? 0)} h`}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-line pt-3 text-[12px] text-ink-3">{integrations.length - fresh.length} other connectors have no runs: they are showcase only and not wired. Alert threshold: 26 h without a good run.</p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-12">
          <CardHeader title="Sync runs" sub="Last 10, most recent first. Sample runs generated with the demo data." action={<StatusChip status="sample" />} />
          <DataTable<SyncRun> rows={runs.slice(0, 10)} rowKey={(r) => r.id} minWidth={760} caption="Sync runs"
            columns={[
              { key: "src", header: "Connector", mobile: "title", cell: (r) => <Link href={`/integrations/${r.integrationId}`} className="font-medium hover:text-accent">{name(r.integrationId)}</Link> },
              { key: "id", header: "Run", cell: (r) => <span className="font-mono text-[12px] text-ink-3">{r.id}</span> },
              { key: "at", header: "Started", mobile: "fact", cell: (r) => <span className="num" title={`${fmtDateTime(r.startedAt)} IST`}>{relTime(r.startedAt, now)}</span> },
              { key: "st", header: "Status", mobile: "action", cell: (r) => <StatusChip status={RUN_TONE[r.status]} label={RUN_LABEL[r.status]} /> },
              { key: "in", header: "Rows in", align: "right", mobile: "fact", cell: (r) => <>{r.rowsIn}<span className="md:hidden"> rows</span></> },
              { key: "rej", header: "Rejected", align: "right", cell: (r) => <span className={r.rowsRejected ? "text-warn-ink" : "text-ink-3"}>{r.rowsRejected}</span> },
              { key: "n", header: "Note", cell: (r) => <span className={r.status === "failed" ? "text-danger" : "text-ink-2"}>{r.note}</span> },
            ]} />
        </Card>

        <Card className="lg:col-span-6">
          <CardHeader title="Alert rules" sub="Checked by the 09:00 IST cron and by Run check. Owner edits; Data reads." />
          <ul className="divide-y divide-line border-t border-line">
            {snap.alertRules.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-ink">{r.name}</div>
                  <div className="mt-0.5 text-[12px] text-ink-2">{r.condition}</div>
                  <div className="mt-0.5 text-[12px] text-ink-3">Notifies {r.notifyTo}</div>
                </div>
                <RuleToggle id={r.id} name={r.name} enabled={r.enabled} />
              </li>
            ))}
          </ul>
        </Card>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-6">
          <Card>
            <CardHeader title="Restore drill log" sub="Restore the latest dump into a scratch database and compare row counts." />
            <ul className="divide-y divide-line border-t border-line">
              {snap.drillLog.map((d) => (
                <li key={d.at} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <Badge tone={d.result === "pass" ? "success" : "danger"}>{d.result === "pass" ? "Pass" : "Fail"}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-ink num">{fmtDateY(d.at)} · {d.durationMin} min</div>
                    <div className="mt-0.5 text-[12px] text-ink-2">{d.notes}</div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Not covered by any backup" sub="Supabase daily backups do not include Storage objects or Edge Functions; our nightly dump covers the database only." />
            <CardBody>
              <ul className="flex flex-col gap-1.5">{snap.notCovered.map((n) => <li key={n} className="flex items-start gap-2 text-[13px] text-ink-2"><CircleX className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />{n}</li>)}</ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function Tile({ label, value, foot, tone }: { label: string; value: string; foot: React.ReactNode; tone?: "warn" | "danger" }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 rounded-md border border-line bg-surface p-4 shadow-1">
      <div>
        <div className="text-[12px] font-medium text-ink-2">{label}</div>
        <div className={cn("mt-1 text-[22px] font-semibold leading-7 num", tone === "warn" ? "text-warn-ink" : tone === "danger" ? "text-danger" : "text-ink")}>{value}</div>
      </div>
      <div className="border-t border-line pt-2 text-[12px] leading-4 text-ink-3">{foot}</div>
    </div>
  );
}
