// Ports for the backups jobs. The Supabase implementation is in store.ts; tests use an in-memory one.
import type { AlertRule, RuleDraft } from "./types";
import type { IntegrationLite, RunLite } from "./freshness";

export type CheckKindDb = "supabase_daily" | "logical_dump" | "restore_drill" | "row_count" | "heartbeat";
export interface CheckRow {
  id: number; kind: string; status: "success" | "failed" | "missing" | "unknown"; checkedAt: string; takenAt: string | null;
  sizeBytes: number | null; retentionDays: number | null; pitr: boolean | null; location: string | null;
  rowCounts: Record<string, unknown> | null; detail: string | null;
}
export interface NewCheck {
  workspaceId: string | null; tenantId: string | null; kind: CheckKindDb; status: CheckRow["status"]; takenAt: string;
  sizeBytes?: number | null; location?: string | null; rowCounts?: Record<string, unknown> | null; detail?: string | null;
}
export interface WorkspaceRef { id: string; tenantId: string }
export interface SchemaInfo { hash: string; tables: number; columns: number }
export interface NotifyRow { workspaceId: string; userId: string; kind: string; title: Record<string, string>; body: Record<string, string>; url: string }

export interface BackupStore {
  workspaces(): Promise<WorkspaceRef[]>;
  rules(ws: string): Promise<AlertRule[]>;
  insertRules(ws: WorkspaceRef, drafts: RuleDraft[]): Promise<void>;
  latestCheck(ws: string | null, kind: CheckKindDb, onlySuccess?: boolean): Promise<CheckRow | null>;
  checks(ws: string, kind: CheckKindDb, limit: number): Promise<CheckRow[]>;
  insertCheck(c: NewCheck): Promise<number>;
  /** Live row counts for the tracked tables in one workspace; null for a table that could not be counted. */
  liveCounts(ws: string, tables: readonly string[]): Promise<Record<string, number | null>>;
  integrations(ws: string): Promise<IntegrationLite[]>;
  runs(ws: string, sinceIso: string): Promise<RunLite[]>;
  /** Active members who may act on data health (data_health.manage or backups.manage). */
  recipients(ws: string): Promise<string[]>;
  /** Which dedupe keys already produced a notification for these users. */
  notified(ws: string, userIds: string[], keys: string[]): Promise<Set<string>>;
  notify(rows: NotifyRow[]): Promise<void>;
  schema(): Promise<SchemaInfo | null>;
  /** Hours between runs of a connector stream, from its schedule; null when it has none. */
  cadenceOf(connectorId: string, stream: string | null): number | null;
}
