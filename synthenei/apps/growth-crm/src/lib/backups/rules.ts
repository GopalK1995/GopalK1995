// Default alert rules and the pure evaluator. No I/O: the job, the page and "Run check" all feed this the same inputs.
import {
  DRILL_OVERDUE_HOURS, FAILED_RUNS_LIMIT, ROW_DROP_MIN_BASELINE, ROW_DROP_PCT, STALE_AFTER_HOURS,
  type AlertRule, type ConnectorFreshness, type Finding, type RuleDraft, type RuleKind, type RuleState, type TableCount,
} from "./types";

export const DEFAULT_RULES: Record<RuleKind, RuleDraft & { kind: RuleKind }> = {
  heartbeat_stale: { kind: "heartbeat_stale", name: "Nightly heartbeat missing", condition: `No heartbeat in ${STALE_AFTER_HOURS} hours`, maxAgeHours: STALE_AFTER_HOURS, maxDropPct: null, notifyTo: "Owner, Data (in app)", enabled: true },
  row_drop: { kind: "row_drop", name: "Row-count drop", condition: `Any table ${ROW_DROP_PCT}% below the last heartbeat`, maxAgeHours: null, maxDropPct: ROW_DROP_PCT, notifyTo: "Owner, Data (in app)", enabled: true },
  drill_overdue: { kind: "drill_overdue", name: "Restore drill overdue", condition: "No passing drill in 90 days", maxAgeHours: DRILL_OVERDUE_HOURS, maxDropPct: null, notifyTo: "Owner, Data (in app)", enabled: true },
  sync_stale: { kind: "sync_stale", name: "Sync stale", condition: `A live connector has no good run in ${STALE_AFTER_HOURS} hours`, maxAgeHours: STALE_AFTER_HOURS, maxDropPct: null, notifyTo: "Owner, Data (in app)", enabled: true },
  sync_failed: { kind: "sync_failed", name: "Sync failed twice", condition: `A live connector failed on ${FAILED_RUNS_LIMIT} runs in a row`, maxAgeHours: null, maxDropPct: null, notifyTo: "Owner, Data (in app)", enabled: true },
  // Off until the owner decides how often the integrator machine runs the full dump (runbook: docs/backups-runbook.md).
  dump_stale: { kind: "dump_stale", name: "Full dump is old", condition: "No full dump recorded in 8 days", maxAgeHours: 8 * 24, maxDropPct: null, notifyTo: "Owner (in app)", enabled: false },
};
export const DEFAULT_RULE_LIST: RuleDraft[] = Object.values(DEFAULT_RULES);

export interface EvalInput {
  now: number;
  heartbeatAt: string | null;
  dumpAt: string | null;
  /** Latest restore drill that PASSED. */
  drillPassAt: string | null;
  counts: TableCount[];
  freshness: ConnectorFreshness[];
}

const H = 3600e3;
const hrs = (n: number) => (n >= 48 ? `${Math.round(n / 24)} days` : `${Math.round(n)} h`);
const ageH = (at: string | null, now: number) => (at ? (now - Date.parse(at)) / H : Infinity);

/** Findings for ONE rule against the inputs. A paused rule never fires; callers filter on enabled. */
export function evaluateRule(rule: AlertRule, i: EvalInput): Finding[] {
  if (!rule.kind) return [];
  const kind = rule.kind;
  const f = (subject: string, title: string, detail: string): Finding => ({ ruleId: rule.id, kind, subject, title, detail });
  switch (kind) {
    case "heartbeat_stale":
    case "dump_stale":
    case "drill_overdue": {
      const at = kind === "heartbeat_stale" ? i.heartbeatAt : kind === "dump_stale" ? i.dumpAt : i.drillPassAt;
      const limit = rule.maxAgeHours ?? STALE_AFTER_HOURS;
      const age = ageH(at, i.now);
      if (age <= limit) return [];
      const what = kind === "heartbeat_stale" ? "heartbeat" : kind === "dump_stale" ? "full dump" : "passing restore drill";
      return [f(kind, rule.name, Number.isFinite(age) ? `Last ${what} was ${hrs(age)} ago (limit ${hrs(limit)}).` : `No ${what} has been recorded yet.`)];
    }
    case "row_drop": {
      const pct = rule.maxDropPct ?? ROW_DROP_PCT;
      return i.counts.flatMap((t) => {
        if (t.current === null || t.atLastDump === null || t.atLastDump < ROW_DROP_MIN_BASELINE) return [];
        const change = ((t.current - t.atLastDump) / t.atLastDump) * 100;
        return change < -pct ? [f(`row_drop:${t.table}`, `${rule.name}: ${t.table}`, `${t.table} has ${t.current} rows, ${t.atLastDump} at the last heartbeat (${change.toFixed(1)}%).`)] : [];
      });
    }
    case "sync_stale": {
      const limit = rule.maxAgeHours ?? STALE_AFTER_HOURS;
      return i.freshness.filter((c) => c.alertable && (c.ageHours === null || c.ageHours > limit)).map((c) =>
        f(`sync_stale:${c.key}`, `${rule.name}: ${c.label}`, c.ageHours === null ? `${c.label} has never had a good run.` : `${c.label} last had a good run ${hrs(c.ageHours)} ago (limit ${hrs(limit)}).`));
    }
    case "sync_failed":
      return i.freshness.filter((c) => c.alertable && c.consecutiveFailures >= FAILED_RUNS_LIMIT).map((c) =>
        f(`sync_failed:${c.key}`, `${rule.name}: ${c.label}`, `${c.label} failed on its last ${c.consecutiveFailures} runs.`));
  }
}

/** All enabled rules. */
export function evaluateRules(rules: AlertRule[], i: EvalInput): Finding[] {
  return rules.filter((r) => r.enabled).flatMap((r) => evaluateRule(r, i));
}

/** Per-rule state for the page. "unknown" for a rule whose kind this build does not know. */
export function ruleStates(rules: AlertRule[], i: EvalInput): Record<string, { state: RuleState; findings: Finding[] }> {
  return Object.fromEntries(rules.map((r) => {
    if (!r.kind) return [r.id, { state: "unknown" as RuleState, findings: [] as Finding[] }];
    if (!r.enabled) return [r.id, { state: "paused" as RuleState, findings: [] as Finding[] }];
    const findings = evaluateRule(r, i);
    return [r.id, { state: (findings.length ? "firing" : "ok") as RuleState, findings }];
  }));
}
