// Loads the inputs for one workspace, evaluates its persisted alert rules and notifies. Used by the hourly job and by
// "Run check" (same code, so the button shows what the job would do).
import { computeFreshness } from "./freshness";
import { runHeartbeat } from "./heartbeat";
import type { BackupStore, CheckRow } from "./ports";
import { DEFAULT_RULE_LIST, evaluateRules, ruleStates, type EvalInput } from "./rules";
import { TRACKED_TABLES } from "./tracked";
import type { AlertRule, ConnectorFreshness, Finding, TableCount } from "./types";

export const FRESHNESS_WINDOW_DAYS = 14;
const D = 86400e3;

/** Notification dedupe bucket: daily for live problems, weekly for slow ones (drill, full dump) so they nag but do not flood. */
export function dedupeKey(f: Finding, now: number): string {
  const slow = f.kind === "drill_overdue" || f.kind === "dump_stale";
  const day = Math.floor(now / D);
  return `dh:${f.ruleId}:${f.subject}:${slow ? `w${Math.floor(day / 7)}` : `d${day}`}`;
}

/** Counts now (live) beside the counts recorded by the last heartbeat. */
export function countsFrom(live: Record<string, number | null>, heartbeat: CheckRow | null): TableCount[] {
  const base = ((heartbeat?.rowCounts as { counts?: Record<string, number | null> } | null)?.counts) ?? {};
  return TRACKED_TABLES.map((t) => ({ table: t, current: live[t] ?? null, atLastDump: typeof base[t] === "number" ? (base[t] as number) : null }));
}

export interface WorkspaceHealth { input: EvalInput; rules: AlertRule[]; findings: Finding[]; states: ReturnType<typeof ruleStates>; heartbeat: CheckRow | null; bootstrapped: boolean; createdDefaults: boolean }

/** Reads everything needed to judge one workspace. Unless readOnly, creates the default rules the first time and a first heartbeat when none exists (pages never write). */
export async function loadWorkspaceHealth(store: BackupStore, ws: { id: string; tenantId: string }, now: number, opts: { readOnly?: boolean } = {}): Promise<WorkspaceHealth> {
  let rules = await store.rules(ws.id);
  let createdDefaults = false;
  if (!rules.length && !opts.readOnly) { await store.insertRules(ws, DEFAULT_RULE_LIST); rules = await store.rules(ws.id); createdDefaults = true; }

  let heartbeat = await store.latestCheck(ws.id, "heartbeat");
  let bootstrapped = false;
  if (!heartbeat && !opts.readOnly) { await runHeartbeat(store, { now, workspaceId: ws.id }); heartbeat = await store.latestCheck(ws.id, "heartbeat"); bootstrapped = true; }

  const [dump, drill, live, integrations, runs] = await Promise.all([
    store.latestCheck(ws.id, "logical_dump"), store.latestCheck(ws.id, "restore_drill"),
    store.liveCounts(ws.id, TRACKED_TABLES), store.integrations(ws.id), store.runs(ws.id, new Date(now - FRESHNESS_WINDOW_DAYS * D).toISOString()),
  ]);
  const freshness: ConnectorFreshness[] = computeFreshness(integrations, runs, now, store.cadenceOf);
  const input: EvalInput = {
    now, heartbeatAt: heartbeat?.takenAt ?? null, dumpAt: dump?.takenAt ?? null, drillPassAt: drill?.takenAt ?? null,
    counts: countsFrom(live, bootstrapped ? null : heartbeat), freshness,
  };
  return { input, rules, findings: evaluateRules(rules, input), states: ruleStates(rules, input), heartbeat, bootstrapped, createdDefaults };
}

export interface EvaluateResult { findings: number; notified: number; createdDefaults: boolean }

export async function evaluateWorkspace(store: BackupStore, ws: { id: string; tenantId: string }, now = Date.now()): Promise<EvaluateResult & { health: WorkspaceHealth }> {
  const health = await loadWorkspaceHealth(store, ws, now);
  if (!health.findings.length) return { findings: 0, notified: 0, createdDefaults: health.createdDefaults, health };
  const users = await store.recipients(ws.id);
  if (!users.length) return { findings: health.findings.length, notified: 0, createdDefaults: health.createdDefaults, health };
  const keyed = health.findings.map((f) => ({ f, key: dedupeKey(f, now) }));
  const seen = await store.notified(ws.id, users, keyed.map((k) => k.key));
  const fresh = keyed.filter((k) => !seen.has(k.key));
  const rows = users.flatMap((userId) => fresh.map(({ f, key }) => ({
    workspaceId: ws.id, userId, kind: "data_health.alert", url: "/data-health",
    title: { en: f.title.slice(0, 120) }, body: { en: f.detail.slice(0, 140), dedupe: key },
  })));
  await store.notify(rows);
  return { findings: health.findings.length, notified: rows.length, createdDefaults: health.createdDefaults, health };
}

/** All workspaces; one failing workspace never stops the rest. */
export async function evaluateAll(store: BackupStore, now = Date.now()): Promise<{ workspaces: number; findings: number; notified: number; failed: number }> {
  const all = await store.workspaces();
  const out = { workspaces: all.length, findings: 0, notified: 0, failed: 0 };
  for (const ws of all) {
    try { const r = await evaluateWorkspace(store, ws, now); out.findings += r.findings; out.notified += r.notified; } catch { out.failed++; }
  }
  return out;
}
