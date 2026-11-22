import { describe, expect, it } from "vitest";
import { countsFrom, dedupeKey, evaluateAll, evaluateWorkspace, loadWorkspaceHealth } from "../evaluate";
import { DEFAULT_RULE_LIST } from "../rules";
import { TRACKED_TABLES } from "../tracked";
import type { Finding } from "../types";
import { FakeStore, mkWs } from "./fake-store";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const H = 3600e3, D = 86400e3;
const ago = (hours: number) => new Date(NOW - hours * H).toISOString();

describe("countsFrom", () => {
  it("pairs live counts with the heartbeat's recorded baseline per tracked table", () => {
    const live = { leads: 90, contacts: 5 };
    const heartbeat = { rowCounts: { counts: { leads: 100, contacts: null } } } as never;
    const out = countsFrom(live, heartbeat);
    expect(out).toHaveLength(TRACKED_TABLES.length);
    expect(out.find((t) => t.table === "leads")).toEqual({ table: "leads", current: 90, atLastDump: 100 });
    expect(out.find((t) => t.table === "contacts")).toEqual({ table: "contacts", current: 5, atLastDump: null });
    expect(out.find((t) => t.table === "tasks")).toEqual({ table: "tasks", current: null, atLastDump: null });
  });
  it("no heartbeat at all means no baseline for anything", () => {
    expect(countsFrom({ leads: 5 }, null).every((t) => t.atLastDump === null)).toBe(true);
  });
});

describe("dedupeKey", () => {
  it("buckets fast-moving problems by day and slow ones (drill, dump) by week", () => {
    const daily: Finding = { ruleId: "r1", kind: "heartbeat_stale", subject: "heartbeat_stale", title: "", detail: "" };
    const weekly: Finding = { ruleId: "r2", kind: "drill_overdue", subject: "drill_overdue", title: "", detail: "" };
    expect(dedupeKey(daily, NOW)).toMatch(/^dh:r1:heartbeat_stale:d\d+$/);
    expect(dedupeKey(weekly, NOW)).toMatch(/^dh:r2:drill_overdue:w\d+$/);
    // Six hours later, same day: identical key. A day later: a different one.
    expect(dedupeKey(daily, NOW)).toBe(dedupeKey(daily, NOW + 6 * H));
    expect(dedupeKey(daily, NOW)).not.toBe(dedupeKey(daily, NOW + 1 * D));
  });
});

describe("loadWorkspaceHealth", () => {
  it("bootstraps default rules and a first heartbeat on an empty workspace, read-write", async () => {
    const store = new FakeStore();
    const ws = mkWs();
    store.wss = [ws];
    store.counts[ws.id] = { leads: 5 };
    const h = await loadWorkspaceHealth(store, ws, NOW);
    expect(h.createdDefaults).toBe(true);
    expect(h.bootstrapped).toBe(true);
    expect(h.rules).toHaveLength(DEFAULT_RULE_LIST.length);
    expect(h.heartbeat).not.toBeNull();
    // A second load sees the rules and heartbeat already there and does not create them again.
    const h2 = await loadWorkspaceHealth(store, ws, NOW);
    expect(h2.createdDefaults).toBe(false);
    expect(h2.bootstrapped).toBe(false);
  });

  it("readOnly never writes, even on a brand-new workspace (used by the real page view)", async () => {
    const store = new FakeStore();
    const ws = mkWs();
    const h = await loadWorkspaceHealth(store, ws, NOW, { readOnly: true });
    expect(h.rules).toEqual([]);
    expect(h.heartbeat).toBeNull();
    expect(h.createdDefaults).toBe(false);
    expect(h.bootstrapped).toBe(false);
  });

  it("findings reflect a stale heartbeat once the default rules are in place", async () => {
    const store = new FakeStore();
    const ws = mkWs();
    await store.insertRules(ws, DEFAULT_RULE_LIST);
    await store.insertCheck({ workspaceId: ws.id, tenantId: ws.tenantId, kind: "heartbeat", status: "success", takenAt: ago(30), rowCounts: { counts: {} } });
    const h = await loadWorkspaceHealth(store, ws, NOW);
    expect(h.findings.some((f) => f.kind === "heartbeat_stale")).toBe(true);
    expect(h.states[h.rules.find((r) => r.kind === "heartbeat_stale")!.id].state).toBe("firing");
  });
});

describe("evaluateWorkspace / evaluateAll", () => {
  it("notifies every recipient once per fresh finding, and not again for the same dedupe bucket", async () => {
    const store = new FakeStore();
    const ws = mkWs();
    await store.insertRules(ws, DEFAULT_RULE_LIST);
    await store.insertCheck({ workspaceId: ws.id, tenantId: ws.tenantId, kind: "heartbeat", status: "success", takenAt: ago(30), rowCounts: { counts: {} } });
    store.recipientsByWs[ws.id] = ["u-owner", "u-data"];

    const first = await evaluateWorkspace(store, ws, NOW);
    expect(first.findings).toBeGreaterThan(0);
    expect(first.notified).toBe(2 * first.findings); // every recipient, every finding
    expect(store.notifyRows).toHaveLength(first.notified);

    const second = await evaluateWorkspace(store, ws, NOW + H); // same day bucket
    expect(second.notified).toBe(0);
  });

  it("no recipients means nothing to notify but still reports the finding count", async () => {
    const store = new FakeStore();
    const ws = mkWs();
    await store.insertRules(ws, DEFAULT_RULE_LIST);
    await store.insertCheck({ workspaceId: ws.id, tenantId: ws.tenantId, kind: "heartbeat", status: "success", takenAt: ago(30), rowCounts: { counts: {} } });
    const r = await evaluateWorkspace(store, ws, NOW);
    expect(r.findings).toBeGreaterThan(0);
    expect(r.notified).toBe(0);
  });

  it("evaluateAll sums across workspaces and keeps going when one throws", async () => {
    const store = new FakeStore();
    store.wss = [mkWs("ok-1", "t-1"), mkWs("boom", "t-1")];
    store.counts["ok-1"] = { leads: 5 };
    const realRules = store.rules.bind(store);
    store.rules = async (ws: string) => { if (ws === "boom") throw new Error("db down"); return realRules(ws); };
    const r = await evaluateAll(store, NOW);
    expect(r).toMatchObject({ workspaces: 2, failed: 1 });
  });
});
