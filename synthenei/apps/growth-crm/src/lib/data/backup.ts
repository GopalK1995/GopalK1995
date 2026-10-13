// Backup monitor data access. The screen depends ONLY on BackupMonitorAdapter.
//
// To go real (Krishna):
//  1. Write a class implementing BackupMonitorAdapter that reads backup_checks (see supabase/schema.sql) and live row counts.
//  2. backup_checks rows are written by (a) our own scheduled `supabase db dump` / pg_dump job to separate storage (heartbeat + size + row counts)
//     and (b) optionally a Supabase Management API call IF its backup endpoints are confirmed (not verified at time of writing).
//  3. Supabase does not back up Storage objects or Edge Functions, so the real adapter must report them as "not covered".
//  4. Select it with BACKUP_ADAPTER=supabase in getBackupAdapter().
import { datasetFor } from "./mock/generate-index";
const dataset = datasetFor("tn");
const { leads, tasks, consent: consentLog, now: NOW_ISO } = dataset;

export type CheckStatus = "success" | "failed" | "missing" | "unknown";
export interface BackupCheck { kind: "supabase_daily" | "logical_dump" | "restore_drill"; status: CheckStatus; takenAt: string | null; sizeBytes: number | null; location: string; detail: string }
export interface TableCount { table: string; current: number; atLastDump: number }
export interface AlertRule { id: number; name: string; condition: string; maxAgeHours: number | null; notifyTo: string; enabled: boolean }
export interface DrillLogEntry { at: string; result: "pass" | "fail"; durationMin: number; notes: string }
export interface BackupSnapshot {
  isMock: boolean; generatedAt: string;
  retentionDays: number | null; pitrEnabled: boolean | null;
  checks: BackupCheck[]; tableCounts: TableCount[]; alertRules: AlertRule[]; drillLog: DrillLogEntry[];
  notCovered: string[]; staleAfterHours: number;
}
export interface BackupMonitorAdapter { readonly name: string; getSnapshot(): Promise<BackupSnapshot> }

const H = 3600e3, D = 24 * H, now = new Date(NOW_ISO).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

export const mockBackupAdapter: BackupMonitorAdapter = {
  name: "mock",
  async getSnapshot() {
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
        { kind: "supabase_daily", status: "success", takenAt: iso(now - 6 * H), sizeBytes: 18_400_000, location: "supabase-managed", detail: "Mock value. Supabase daily backup; Free/Pro keep 7 days." },
        { kind: "logical_dump", status: "success", takenAt: iso(now - 10 * H), sizeBytes: 6_200_000, location: "offsite bucket (not chosen yet)", detail: "Mock value. Our own pg_dump job; not built yet." },
        { kind: "restore_drill", status: "success", takenAt: iso(now - 44 * D), sizeBytes: null, location: "scratch database", detail: "Mock value. Dump restored and row counts matched." },
      ],
      tableCounts: counts,
      alertRules: [
        { id: 1, name: "Backup is stale", condition: "No successful backup in 26 hours", maxAgeHours: 26, notifyTo: "Owner (email)", enabled: true },
        { id: 2, name: "Row-count drop", condition: "Any table 5% below last dump", maxAgeHours: null, notifyTo: "Owner (email)", enabled: true },
        { id: 3, name: "Restore drill overdue", condition: "No passing drill in 90 days", maxAgeHours: 2160, notifyTo: "Owner, Data", enabled: true },
        { id: 4, name: "Sync failed twice", condition: "Integration sync failed on 2 consecutive runs", maxAgeHours: null, notifyTo: "Marketing, Data", enabled: false },
      ],
      drillLog: [
        { at: iso(now - 44 * D), result: "pass", durationMin: 22, notes: "Mock entry. Restored latest dump into scratch DB; counts matched." },
        { at: iso(now - 135 * D), result: "fail", durationMin: 41, notes: "Mock entry. Role/extension mismatch on restore; runbook updated." },
      ],
      notCovered: ["Supabase Storage objects (files)", "Edge Functions code and secrets", "Anything outside the Postgres database (e.g. CSV originals)"],
    } satisfies BackupSnapshot;
  },
};

export function getBackupAdapter(): BackupMonitorAdapter {
  if (process.env.BACKUP_ADAPTER === "supabase") throw new Error("Supabase backup adapter is not implemented yet. See comments in src/lib/backup.ts.");
  return mockBackupAdapter;
}
