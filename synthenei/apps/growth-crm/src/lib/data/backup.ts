// Backup monitor data access. The screen depends ONLY on BackupMonitorAdapter.
//
// Real sessions read backup_checks, backup_alert_rules, sync_runs and live row counts (src/lib/backups/adapter.ts).
// Demo sessions and the platform console (no workspace) read the labelled mock below. What writes the rows:
//  - heartbeat: the nightly `backup.heartbeat` job (schema fingerprint + per-workspace row counts, src/lib/backups/heartbeat.ts);
//  - logical_dump: the integrator machine after a full pg_dump (docs/backups-runbook.md);
//  - restore_drill: the "Log restore drill" action;
//  - supabase_daily: nothing yet. Supabase has no API for backup status, so the page says "not recorded" instead of inventing it.
// Supabase does not back up Storage objects or Edge Functions, so the snapshot reports them as "not covered".
import { datasetFor } from "./mock/generate-index";
import { computeFreshness } from "../backups/freshness";
import type { AlertRule as BackupAlertRule, ConnectorFreshness, RuleState, TableCount } from "../backups/types";
import type { Workspace } from "../tenancy";
import { loadEnv } from "../env";
import type { Dataset } from "./types";

export type CheckStatus = "success" | "failed" | "missing" | "unknown";
export interface BackupCheck { kind: "supabase_daily" | "logical_dump" | "restore_drill" | "heartbeat"; status: CheckStatus; takenAt: string | null; sizeBytes: number | null; location: string; detail: string }
export type { TableCount } from "../backups/types";
export type AlertRule = BackupAlertRule & { state: RuleState; detail: string | null };
export interface DrillLogEntry { at: string; result: "pass" | "fail"; durationMin: number; notes: string }
export interface BackupSnapshot {
  isMock: boolean; generatedAt: string;
  retentionDays: number | null; pitrEnabled: boolean | null;
  checks: BackupCheck[]; tableCounts: TableCount[]; alertRules: AlertRule[]; drillLog: DrillLogEntry[];
  /** False when the workspace has no persisted rules yet (the first job run, or "Create default rules", writes them). */
  rulesPersisted: boolean;
  /** Per connector and stream, from sync_runs (sample runs in demo). */
  freshness: ConnectorFreshness[];
  heartbeat: { at: string | null; schemaHash: string | null; tables: number | null; columns: number | null } | null;
  notCovered: string[]; staleAfterHours: number;
}
export interface BackupMonitorAdapter { readonly name: string; getSnapshot(): Promise<BackupSnapshot> }

const H = 3600e3, D = 24 * H;
const iso = (ms: number) => new Date(ms).toISOString();

/** Mock adapter scoped to one workspace dataset (row counts are that workspace's). */
export const mockBackupAdapter = (dataset: Dataset): BackupMonitorAdapter => ({
  name: "mock",
  async getSnapshot() {
    const { leads, tasks, consent: consentLog, now: NOW_ISO } = dataset;
    const now = new Date(NOW_ISO).getTime();
    const counts = [
      { table: "leads", current: leads.length, atLastDump: leads.length - 2 },
      { table: "activities", current: dataset.activities.length + 2810, atLastDump: dataset.activities.length + 2760 },
      { table: "campaigns", current: dataset.campaigns.length, atLastDump: dataset.campaigns.length },
      { table: "campaign_daily_metrics", current: dataset.campaignDays.length, atLastDump: dataset.campaignDays.length - 8 },
      { table: "ga4_daily", current: dataset.ga4.length, atLastDump: dataset.ga4.length - 1 },
      { table: "deals", current: dataset.deals.length, atLastDump: dataset.deals.length },
      { table: "accounts", current: dataset.accounts.length, atLastDump: dataset.accounts.length },
      { table: "tasks", current: tasks.length, atLastDump: tasks.length - 1 },
      { table: "consent_log", current: consentLog.length, atLastDump: consentLog.length - 3 },
    ];
    return {
      isMock: true, generatedAt: NOW_ISO, retentionDays: 7, pitrEnabled: false, staleAfterHours: 26,
      checks: [
        { kind: "heartbeat", status: "success", takenAt: iso(now - 10 * H), sizeBytes: null, location: "logical heartbeat", detail: "Mock value. Schema fingerprint and row counts." },
        { kind: "supabase_daily", status: "success", takenAt: iso(now - 6 * H), sizeBytes: 18_400_000, location: "supabase-managed", detail: "Mock value. Supabase daily backup; Free/Pro keep 7 days." },
        { kind: "logical_dump", status: "success", takenAt: iso(now - 10 * H), sizeBytes: 6_200_000, location: "offsite bucket (not chosen yet)", detail: "Mock value. Full pg_dump from the integrator machine." },
        { kind: "restore_drill", status: "success", takenAt: iso(now - 44 * D), sizeBytes: null, location: "scratch database", detail: "Mock value. Dump restored and row counts matched." },
      ],
      tableCounts: counts,
      rulesPersisted: true,
      heartbeat: { at: iso(now - 10 * H), schemaHash: "sample", tables: null, columns: null },
      freshness: computeFreshness(
        dataset.integrations.map((i) => ({ id: i.id, label: i.name, connectorId: i.id, status: "sandbox" })),
        dataset.syncRuns.map((r) => ({ integrationId: r.integrationId, stream: null, status: r.status, startedAt: r.startedAt, mode: "sandbox" })), now),
      alertRules: [
        { id: "1", kind: "heartbeat_stale", name: "Backup is stale", condition: "No successful backup in 26 hours", maxAgeHours: 26, maxDropPct: null, notifyTo: "Owner (email)", enabled: true, state: "ok", detail: null },
        { id: "2", kind: "row_drop", name: "Row-count drop", condition: "Any table 5% below last dump", maxAgeHours: null, maxDropPct: 5, notifyTo: "Owner (email)", enabled: true, state: "ok", detail: null },
        { id: "3", kind: "drill_overdue", name: "Restore drill overdue", condition: "No passing drill in 90 days", maxAgeHours: 2160, maxDropPct: null, notifyTo: "Owner, Data", enabled: true, state: "ok", detail: null },
        { id: "4", kind: "sync_failed", name: "Sync failed twice", condition: "Integration sync failed on 2 consecutive runs", maxAgeHours: null, maxDropPct: null, notifyTo: "Marketing, Data", enabled: false, state: "paused", detail: null },
      ],
      drillLog: [
        { at: iso(now - 44 * D), result: "pass", durationMin: 22, notes: "Mock entry. Restored latest dump into scratch DB; counts matched." },
        { at: iso(now - 135 * D), result: "fail", durationMin: 41, notes: "Mock entry. Role/extension mismatch on restore; runbook updated." },
      ],
      notCovered: ["Supabase Storage objects (files)", "Edge Functions code and secrets", "Anything outside the Postgres database (e.g. CSV originals)"],
    } satisfies BackupSnapshot;
  },
});

/** Real adapter for real sessions of a workspace; the mock for demo sessions and for callers with no workspace (platform console). */
export function getBackupAdapter(ws?: Workspace, opts: { demo?: boolean } = {}): BackupMonitorAdapter {
  const real = !!ws && opts.demo === false && loadEnv().dataSourceSupabase;
  if (!real) return mockBackupAdapter(datasetFor(ws?.dataset ?? "tn"));
  return { name: "supabase", async getSnapshot() { return (await import("../backups/adapter")).realSnapshot({ uuid: ws.uuid, tenantId: ws.tenantId }); } };
}
