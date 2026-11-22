import { describe, expect, it } from "vitest";
import { DEFAULT_RULE_LIST, evaluateRule, evaluateRules, ruleStates, type EvalInput } from "../rules";
import type { AlertRule, ConnectorFreshness } from "../types";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const H = 3600e3;
const ago = (hours: number) => new Date(NOW - hours * H).toISOString();
const rule = (over: Partial<AlertRule> = {}): AlertRule => ({ id: "r1", kind: "heartbeat_stale", name: "Nightly heartbeat missing", condition: "", maxAgeHours: null, maxDropPct: null, notifyTo: "Owner", enabled: true, ...over });
const baseInput: EvalInput = { now: NOW, heartbeatAt: ago(1), dumpAt: ago(1), drillPassAt: ago(1), counts: [], freshness: [] };
const conn = (over: Partial<ConnectorFreshness> = {}): ConnectorFreshness => ({
  key: "k1", integrationId: "int-1", label: "WhatsApp", stream: null, ageHours: 1, lastGoodAt: ago(1), lastStatus: "success",
  consecutiveFailures: 0, cadenceHours: null, state: "fresh", alertable: true, mode: "live", ...over,
});

describe("evaluateRule: age-based rules (heartbeat_stale, dump_stale, drill_overdue)", () => {
  it("no finding within the limit; a finding with the age once past it", () => {
    const r = rule({ kind: "heartbeat_stale", maxAgeHours: 26 });
    expect(evaluateRule(r, { ...baseInput, heartbeatAt: ago(10) })).toEqual([]);
    const findings = evaluateRule(r, { ...baseInput, heartbeatAt: ago(30) });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: "r1", kind: "heartbeat_stale", subject: "heartbeat_stale" });
    expect(findings[0].detail).toMatch(/30 h ago \(limit 26 h\)/);
  });
  it("falls back to the default stale threshold when maxAgeHours is unset", () => {
    expect(evaluateRule(rule({ kind: "heartbeat_stale", maxAgeHours: null }), { ...baseInput, heartbeatAt: ago(27) })).toHaveLength(1);
  });
  it("never recorded (null timestamp) is an infinite age and always fires, with a dedicated message", () => {
    const findings = evaluateRule(rule({ kind: "drill_overdue", maxAgeHours: 2160 }), { ...baseInput, drillPassAt: null });
    expect(findings[0].detail).toBe("No passing restore drill has been recorded yet.");
  });
  it("evaluateRule itself does not look at `enabled` -- evaluateRules/ruleStates below are what pause a firing rule", () => {
    expect(evaluateRule(rule({ kind: "heartbeat_stale", maxAgeHours: 26, enabled: false }), { ...baseInput, heartbeatAt: ago(30) })).toHaveLength(1);
  });
});

describe("evaluateRule: row_drop", () => {
  it("flags only a table past the baseline and past the drop percentage", () => {
    const r = rule({ kind: "row_drop", maxDropPct: 5 });
    const i: EvalInput = { ...baseInput, counts: [
      { table: "leads", current: 90, atLastDump: 100 },   // -10%, baseline 100 >= 20: fires
      { table: "tasks", current: 97, atLastDump: 100 },   // -3%, under the threshold: no finding
      { table: "tiny", current: 1, atLastDump: 10 },      // -90% but baseline 10 < 20: ignored (too small to be signal)
      { table: "unknown", current: null, atLastDump: 50 }, // never counted: ignored
    ] };
    const findings = evaluateRule(r, i);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ subject: "row_drop:leads" });
    expect(findings[0].detail).toContain("90 rows, 100 at the last heartbeat (-10.0%)");
  });
});

describe("evaluateRule: sync_stale / sync_failed", () => {
  it("sync_stale fires only for alertable connectors past the limit, including never-run", () => {
    const r = rule({ kind: "sync_stale", maxAgeHours: 26 });
    const i: EvalInput = { ...baseInput, freshness: [
      conn({ key: "fresh", ageHours: 2 }),
      conn({ key: "stale", ageHours: 30 }),
      conn({ key: "never", ageHours: null }),
      conn({ key: "sandboxed", ageHours: 30, alertable: false }),
    ] };
    expect(evaluateRule(r, i).map((f) => f.subject)).toEqual(["sync_stale:stale", "sync_stale:never"]);
  });
  it("sync_failed fires at the configured consecutive-failure limit, never for a non-alertable connector", () => {
    const r = rule({ kind: "sync_failed" });
    const i: EvalInput = { ...baseInput, freshness: [
      conn({ key: "ok", consecutiveFailures: 1 }),
      conn({ key: "bad", consecutiveFailures: 2 }),
      conn({ key: "sandbox-bad", consecutiveFailures: 5, alertable: false }),
    ] };
    expect(evaluateRule(r, i).map((f) => f.subject)).toEqual(["sync_failed:bad"]);
  });
  it("an unknown rule kind (null, e.g. a future schema) produces no findings", () => {
    expect(evaluateRule(rule({ kind: null as unknown as AlertRule["kind"] }), baseInput)).toEqual([]);
  });
});

describe("evaluateRules / ruleStates", () => {
  it("evaluateRules only runs enabled rules", () => {
    const rules = [rule({ id: "a", kind: "heartbeat_stale", maxAgeHours: 26, enabled: true }), rule({ id: "b", kind: "heartbeat_stale", maxAgeHours: 26, enabled: false })];
    expect(evaluateRules(rules, { ...baseInput, heartbeatAt: ago(30) }).map((f) => f.ruleId)).toEqual(["a"]);
  });
  it("ruleStates reports ok/firing/paused/unknown per rule", () => {
    const rules = [
      rule({ id: "rule1", kind: "heartbeat_stale", maxAgeHours: 26, enabled: true }),
      rule({ id: "rule2", kind: "heartbeat_stale", maxAgeHours: 26, enabled: true }),
      rule({ id: "paused", kind: "heartbeat_stale", maxAgeHours: 26, enabled: false }),
      rule({ id: "unknown", kind: null as unknown as AlertRule["kind"], enabled: true }),
    ];
    // heartbeatAt is 30h ago, past every rule's 26h limit, so every enabled, known-kind rule fires.
    const states = ruleStates(rules, { ...baseInput, heartbeatAt: ago(30) });
    expect(states.rule1.state).toBe("firing");
    expect(states.rule2.state).toBe("firing");
    expect(states.paused.state).toBe("paused");
    expect(states.unknown).toEqual({ state: "unknown", findings: [] });
  });
});

describe("DEFAULT_RULE_LIST", () => {
  it("ships one draft per rule kind, with dump_stale off by default (needs an owner decision first)", () => {
    expect(DEFAULT_RULE_LIST).toHaveLength(6);
    expect(DEFAULT_RULE_LIST.find((r) => r.kind === "dump_stale")?.enabled).toBe(false);
    expect(DEFAULT_RULE_LIST.filter((r) => r.kind !== "dump_stale").every((r) => r.enabled)).toBe(true);
  });
});
