// Data health and backups: shared shapes. Pure types, safe for client and server.
export const STALE_AFTER_HOURS = 26;
export const DRILL_OVERDUE_HOURS = 90 * 24;
export const ROW_DROP_PCT = 5;
/** A table smaller than this at the last heartbeat is never flagged for a drop: 1 row of 10 is not a 10% loss signal. */
export const ROW_DROP_MIN_BASELINE = 20;
export const FAILED_RUNS_LIMIT = 2;

/** Rule kinds. Persisted in backup_alert_rules.check_kind (no new column needed). */
export const RULE_KINDS = ["heartbeat_stale", "dump_stale", "row_drop", "drill_overdue", "sync_stale", "sync_failed"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const KIND_TO_CHECK: Record<RuleKind, string> = {
  heartbeat_stale: "heartbeat", dump_stale: "logical_dump", row_drop: "row_count", drill_overdue: "restore_drill", sync_stale: "sync_stale", sync_failed: "sync_failed",
};
export const checkToKind = (c: string): RuleKind | null => (RULE_KINDS.find((k) => KIND_TO_CHECK[k] === c) ?? null);

export interface AlertRule {
  id: string; kind: RuleKind | null; name: string; condition: string;
  maxAgeHours: number | null; maxDropPct: number | null; notifyTo: string; enabled: boolean;
}
export type RuleDraft = Omit<AlertRule, "id">;

export type FreshState = "fresh" | "late" | "stale" | "never";
export interface ConnectorFreshness {
  key: string; integrationId: string; label: string; stream: string | null;
  /** Hours since the last good (success or partial) run; null when it never had one. */
  ageHours: number | null; lastGoodAt: string | null;
  lastStatus: "success" | "partial" | "failed" | "running" | null;
  consecutiveFailures: number;
  /** Expected hours between runs, from the stream's own schedule; null when the stream has none. */
  cadenceHours: number | null;
  state: FreshState;
  /** True only for a live connection. Sandbox and showcase connections are shown but never alert. */
  alertable: boolean;
  mode: "sandbox" | "live" | null;
}

export interface TableCount { table: string; current: number | null; atLastDump: number | null }
export interface Finding { ruleId: string; kind: RuleKind; subject: string; title: string; detail: string }
export type RuleState = "ok" | "firing" | "paused" | "unknown";
