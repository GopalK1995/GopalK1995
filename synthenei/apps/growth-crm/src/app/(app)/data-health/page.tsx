import Link from "next/link";
import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";
import { pageCtx } from "@/lib/data/context";
import { getBackupAdapter, type BackupSnapshot } from "@/lib/data/backup";
import { can } from "@/lib/authz";
import { loadPrincipal } from "@/lib/authz/load";
import { fmtDateTime, fmtDateY, num, relTime } from "@/lib/format";
import { Card, CardBody, CardHeader, NavyPanel } from "@/components/ui/card";
import { Badge, StatusChip } from "@/components/ui/badge";
import { PageHeader, Meter } from "@/components/ui/misc";
import { DataTable } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { DefaultRulesButton, HeartbeatButton, LogDrillButton, RuleToggle, RunCheckButton } from "./_components/controls";
import type { SyncRun } from "@/lib/data/types";
import type { ConnectorFreshness } from "@/lib/backups/types";
import { pageTitle } from "@/i18n/server";

export const generateMetadata = pageTitle("dataHealth");
const H = 3600e3, D = 24 * H;
/** Demo runs are simulated: neutral, never green. Real runs show their real outcome. */
const SIM_TONE = { success: "not_configured", partial: "needs_attention", failed: "error" } as const;
const SIM_LABEL = { success: "Simulated", partial: "Simulated · partial", failed: "Simulated · failed" } as const;
const REAL_TONE = { success: "success", partial: "warn", failed: "danger" } as const;
const REAL_LABEL = { success: "Success", partial: "Partial", failed: "Failed" } as const;
const bytes = (n: number | null) => (n === null ? "–" : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const hrs = (ms: number) => (ms < D ? `${Math.round(ms / H)} h` : `${Math.round(ms / D)} d`);
const ageLabel = (h: number | null) => (h === null ? "no good run" : h < 1 ? "under 1 h" : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`);
const FRESH_DOT: Record<ConnectorFreshness["state"], string> = { fresh: "bg-success", late: "bg-warn", stale: "bg-danger", never: "bg-ink-3" };
const FRESH_WORD: Record<ConnectorFreshness["state"], string> = { fresh: "Fresh", late: "Late", stale: "Stale", never: "Never ran" };

export default async function DataHealth() {
  const { ds, now, active, session } = await pageCtx();
  const principal = await loadPrincipal();
  const canRun = can(principal, "data_health.manage"), canRules = can(principal, "backups.manage");
  const runBlocked = canRun ? null : "You need the Run data health checks permission.";
  const rulesBlocked = canRules ? null : "Only roles with Manage backups edit alert rules.";

  let snap: BackupSnapshot, runs: SyncRun[], names: Map<string, string>;
  try {
    [snap, runs, names] = await Promise.all([
      getBackupAdapter(active.ws, { demo: session.demo === true }).getSnapshot(), ds.syncRuns(), ds.integrations().then((xs) => new Map(xs.map((i) => [i.id, i.name]))),
    ]);
  } catch (e) {
    return (
      <>
        <PageHeader eyebrow="Admin · backups and sync" title="Data health" />
        <ErrorState source="data health" message={e instanceof Error ? e.message.slice(0, 200) : "The read failed. Try again in a moment."} />
      </>
    );
  }
  const nowMs = new Date(now).getTime();
  const beat = snap.checks.find((c) => c.kind === "heartbeat");
  const dump = snap.checks.find((c) => c.kind === "logical_dump");
  const daily = snap.checks.find((c) => c.kind === "supabase_daily");
  const drill = snap.checks.find((c) => c.kind === "restore_drill");
  const beatAge = beat?.takenAt ? nowMs - new Date(beat.takenAt).getTime() : Infinity;
  const stale = beatAge > snap.staleAfterHours * H;
  const dumpDays = dump?.takenAt ? Math.round((nowMs - new Date(dump.takenAt).getTime()) / D) : null;
  const drillDays = drill?.takenAt ? Math.round((nowMs - new Date(drill.takenAt).getTime()) / D) : null;
  const counts = snap.tableCounts.map((t) => {
    const change = t.current !== null && t.atLastDump ? (t.current - t.atLastDump) / t.atLastDump : null;
    return { ...t, change, flag: change !== null && change < -0.05 && (t.atLastDump ?? 0) >= 20 };
  });
  const firing = snap.alertRules.filter((r) => r.state === "firing");
  const name = (id: string) => names.get(id) ?? id;

  return (
    <>
      <PageHeader eyebrow="Admin · backups and sync" title="Data health"
        sub="Is the data fresh, complete and backed up? Supabase has no API for backup status, so our own jobs write the rows this page reads: a nightly heartbeat, and the full dump recorded from the integrator machine."
        actions={<><LogDrillButton blocked={runBlocked} /><HeartbeatButton blocked={runBlocked} /><RunCheckButton blocked={runBlocked} /></>} />

      {snap.isMock && (
        <p role="note" className="mb-4 flex items-start gap-2 rounded-sm border border-dashed border-ink-3/50 bg-surface px-3 py-2 text-[12px] leading-[18px] text-ink-2">
          <Info className="mt-px size-4 shrink-0 text-ink-3" aria-hidden />
          <span><span className="font-medium text-ink">Sample values.</span> This is a demo workspace: tiles, rules and the drill log are simulated and nothing here is saved. Real workspaces read the heartbeat and dump records.</span>
        </p>
      )}
      {firing.length > 0 && (
        <div role="alert" data-testid="firing-banner" className="mb-4 flex items-start gap-2 rounded-sm border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-ink">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <div><span className="font-medium">{firing.length} alert rule{firing.length === 1 ? " is" : "s are"} firing.</span>{" "}{firing.map((r) => r.detail).filter(Boolean).slice(0, 2).join(" ")}</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <NavyPanel className="p-5 lg:col-span-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[12px] font-medium text-navy-ink-2">Nightly logical heartbeat</div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-[32px] font-semibold leading-9 num">{Number.isFinite(beatAge) ? hrs(beatAge) : "never"}</span>
                <span className="text-[13px] text-navy-ink-2">since last heartbeat</span>
              </div>
            </div>
            <span className={cn("inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium", stale ? "bg-danger text-white" : "bg-navy-800 text-navy-ink")}>
              {stale ? <CircleX className="size-3" aria-hidden /> : <CircleCheck className="size-3 text-[oklch(0.8_0.12_155)]" aria-hidden />}{stale ? "Stale" : "Within threshold"}
            </span>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[11px] text-navy-ink-3 num"><span>0 h</span><span>alert at {snap.staleAfterHours} h</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-navy-800" role="meter" aria-valuemin={0} aria-valuemax={snap.staleAfterHours} aria-valuenow={Math.min(snap.staleAfterHours, Number.isFinite(beatAge) ? Math.round(beatAge / H) : snap.staleAfterHours)} aria-label="Hours since last heartbeat">
              <div className={cn("h-full rounded-full", stale ? "bg-danger" : "bg-accent-on-navy")} style={{ width: `${Math.min(100, (beatAge / (snap.staleAfterHours * H)) * 100)}%` }} />
            </div>
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-navy-line pt-4 text-[12px]">
            <div><dt className="text-navy-ink-3">Taken</dt><dd className="mt-0.5 num">{beat?.takenAt ? `${fmtDateTime(beat.takenAt)} IST` : "Not recorded yet"}</dd></div>
            <div><dt className="text-navy-ink-3">Schema fingerprint</dt><dd className="mt-0.5 num">{snap.heartbeat?.schemaHash ?? "Unavailable"}{snap.heartbeat?.tables ? ` · ${snap.heartbeat.tables} tables` : ""}</dd></div>
            <div><dt className="text-navy-ink-3">What it proves</dt><dd className="mt-0.5">Database reachable, schema unchanged, row counts saved. It is not a copy of the data.</dd></div>
            <div><dt className="text-navy-ink-3">Schedule</dt><dd className="mt-0.5">02:00 IST job, checked hourly</dd></div>
          </dl>
        </NavyPanel>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-7">
          <Tile label="Full dump (integrator machine)" value={dumpDays !== null ? `${dumpDays} days ago` : "Never recorded"} tone={dump?.takenAt ? undefined : "warn"}
            foot={<>{dump?.takenAt ? <>Size {bytes(dump.sizeBytes)}. </> : null}Run from the integrator machine and recorded there. Steps: docs/backups-runbook.md.</>} />
          <Tile label="Point-in-time recovery" value={snap.pitrEnabled === null ? "Not recorded" : snap.pitrEnabled ? "On" : "Off"} tone={snap.pitrEnabled === false ? "warn" : undefined}
            foot="A paid Supabase add-on. Without it, the worst case loses up to a day of changes." />
          <Tile label={snap.isMock ? "Supabase daily backup (sample)" : "Supabase daily backup"} value={daily?.takenAt ? relTime(daily.takenAt, now) : "Not recorded"}
            foot={<>{snap.retentionDays ? `Kept ${snap.retentionDays} days. ` : "Retention not recorded. "}Nothing writes this row automatically: confirm it in the Supabase dashboard. Excludes Storage and Edge Functions.</>} />
          <Tile label="Last restore drill" value={drillDays !== null ? `${drillDays} days ago` : "Never"} tone={drillDays === null || drillDays > 90 ? "danger" : undefined}
            foot={<>Target: every 90 days or sooner. <Meter value={drillDays ?? 90} max={90} tone={drillDays === null || drillDays > 75 ? "warn" : "accent"} className="mt-2" /></>} />
        </div>

        <Card className="lg:col-span-7">
          <CardHeader title="Row counts vs last heartbeat" sub="A table of 20 rows or more that shrank more than 5% since the heartbeat is flagged." />
          <DataTable rows={counts} rowKey={(r) => r.table} minWidth={520} caption="Row counts per table"
            columns={[
              { key: "t", header: "Table", mobile: "title", cell: (r) => <span className="font-mono text-[12px]">{r.table}</span> },
              { key: "d", header: "At last heartbeat", align: "right", cell: (r) => (r.atLastDump === null ? <span className="text-ink-3">No baseline</span> : num(r.atLastDump)) },
              { key: "c", header: "Now", align: "right", mobile: "fact", cell: (r) => (r.current === null ? <span className="text-ink-3">Not counted</span> : <>{num(r.current)}<span className="md:hidden"> rows</span></>) },
              { key: "x", header: "Change", align: "right", mobile: "action", cell: (r) => (r.change === null ? <span className="text-ink-3">–</span> : (
                <span className={cn("num", r.flag ? "font-medium text-danger" : r.change > 0 ? "text-ink-2" : "text-ink-3")}>
                  {r.flag && <CircleAlert className="mr-1 inline size-3.5 align-[-2px]" aria-label="Flagged" />}{r.change > 0 ? "+" : ""}{(r.change * 100).toFixed(1)}%
                </span>)) },
            ]} />
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader title="Sync freshness" sub={`Hours since the last good run, per connector and stream. Stale after ${snap.staleAfterHours} h; late means behind its own schedule.`} />
          <CardBody>
            {snap.freshness.length === 0 ? <p className="text-[13px] text-ink-2">No connector has run yet.</p> : (
              <ul className="flex flex-col divide-y divide-line" aria-label="Sync freshness per connector">
                {snap.freshness.map((f) => (
                  <li key={f.key} data-state={f.state} className="flex items-center gap-3 py-2 first:pt-0">
                    <span className={cn("size-2 shrink-0 rounded-full", f.consecutiveFailures > 0 ? "bg-danger" : FRESH_DOT[f.state])} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <Link href={`/integrations/${f.integrationId}`} className="block truncate text-[13px] font-medium text-ink hover:text-accent">{f.label}</Link>
                      <div className="text-[11px] text-ink-3">
                        {f.cadenceHours ? `Runs every ${f.cadenceHours} h` : "No fixed schedule"}{f.mode === "sandbox" ? " · Sandbox" : ""}{!f.alertable ? " · Not alerting" : ""}
                      </div>
                    </div>
                    <span className={cn("text-right text-[12px] num", f.consecutiveFailures > 0 || f.state === "stale" ? "text-danger" : f.state === "late" ? "text-warn-ink" : "text-ink-2")}>
                      <span className="sr-only">{FRESH_WORD[f.state]}. </span>{f.consecutiveFailures > 0 ? `Failed ${f.consecutiveFailures}x · ` : ""}{ageLabel(f.ageHours)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 border-t border-line pt-3 text-[12px] text-ink-3">Connectors that were never connected are not listed. Only live connections raise alerts; sandbox runs are shown but never alert.</p>
          </CardBody>
        </Card>

        <Card className="lg:col-span-12">
          <CardHeader title="Sync runs" sub={snap.isMock ? "Last 10, most recent first. Sample runs generated with the demo data." : "Last 10, most recent first."} action={snap.isMock ? <StatusChip status="sample" /> : undefined} />
          <DataTable<SyncRun> rows={runs.slice(0, 10)} rowKey={(r) => r.id} minWidth={760} caption="Sync runs"
            columns={[
              { key: "src", header: "Connector", mobile: "title", cell: (r) => <Link href={`/integrations/${r.integrationId}`} className="font-medium hover:text-accent">{name(r.integrationId)}</Link> },
              { key: "id", header: "Run", cell: (r) => <span className="font-mono text-[12px] text-ink-3">{r.id}</span> },
              { key: "at", header: "Started", mobile: "fact", cell: (r) => <span className="num" title={`${fmtDateTime(r.startedAt)} IST`}>{relTime(r.startedAt, now)}</span> },
              { key: "st", header: "Status", mobile: "action", cell: (r) => (snap.isMock ? <StatusChip status={SIM_TONE[r.status]} label={SIM_LABEL[r.status]} /> : <Badge tone={REAL_TONE[r.status]}>{REAL_LABEL[r.status]}</Badge>) },
              { key: "in", header: "Rows in", align: "right", mobile: "fact", cell: (r) => <>{r.rowsIn}<span className="md:hidden"> rows</span></> },
              { key: "rej", header: "Rejected", align: "right", cell: (r) => <span className={r.rowsRejected ? "text-warn-ink" : "text-ink-3"}>{r.rowsRejected}</span> },
              { key: "n", header: "Note", cell: (r) => <span className={r.status === "failed" ? "text-danger" : "text-ink-2"}>{r.note}</span> },
            ]} />
        </Card>

        <Card className="lg:col-span-6">
          <CardHeader title="Alert rules" sub="Saved per workspace and evaluated every hour by a job, and by Run check. Notifications go to members who can run data health checks, once per day per problem." />
          {!snap.rulesPersisted ? (
            <div className="border-t border-line px-4 py-4 sm:px-5" data-testid="no-rules">
              <p className="text-[13px] text-ink-2">No rules are saved for this workspace yet. The first hourly job creates the defaults, or create them now.</p>
              <div className="mt-3"><DefaultRulesButton blocked={rulesBlocked} /></div>
            </div>
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {snap.alertRules.map((r) => (
                <li key={r.id} data-rule-state={r.state} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">{r.name}
                      <Badge tone={r.state === "firing" ? "danger" : r.state === "ok" ? "success" : "neutral"}>{r.state === "firing" ? "Firing" : r.state === "ok" ? "OK" : r.state === "paused" ? "Paused" : "Unknown rule"}</Badge>
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-2">{r.condition}</div>
                    {r.state === "firing" && r.detail && <div className="mt-0.5 text-[12px] text-danger">{r.detail}</div>}
                    <div className="mt-0.5 text-[12px] text-ink-3">Notifies {r.notifyTo}</div>
                  </div>
                  <RuleToggle id={r.id} name={r.name} enabled={r.enabled} blocked={rulesBlocked} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-6">
          <Card>
            <CardHeader title="Restore drill log" sub="Restore the latest full dump into a scratch database and compare row counts." />
            {snap.drillLog.length === 0 ? <p className="border-t border-line px-4 py-3 text-[13px] text-ink-2 sm:px-5">No drill has been logged. Run the drill from the runbook, then log it here.</p> : (
              <ul className="divide-y divide-line border-t border-line" aria-label="Restore drill log">
                {snap.drillLog.map((d) => (
                  <li key={d.at} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                    <Badge tone={d.result === "pass" ? "success" : "danger"}>{d.result === "pass" ? "Pass" : "Fail"}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-ink num">{fmtDateY(d.at)}{d.durationMin ? ` · ${d.durationMin} min` : ""}</div>
                      {d.notes && <div className="mt-0.5 text-[12px] text-ink-2">{d.notes}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Not covered by any backup" sub="Supabase daily backups do not include Storage objects or Edge Functions; the full dump covers the database only." />
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
