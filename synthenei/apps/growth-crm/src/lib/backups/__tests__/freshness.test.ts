import { describe, expect, it } from "vitest";
import { cadenceFromCron, computeFreshness, type IntegrationLite, type RunLite } from "../freshness";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const H = 3600e3;
const ago = (hours: number) => new Date(NOW - hours * H).toISOString();
const conn = (over: Partial<IntegrationLite> = {}): IntegrationLite => ({ id: "int-1", label: "WhatsApp", connectorId: "whatsapp", status: "connected", ...over });
const run = (over: Partial<RunLite> = {}): RunLite => ({ integrationId: "int-1", stream: null, status: "success", startedAt: ago(1), mode: "live", ...over });

describe("computeFreshness", () => {
  it("a connector with no runs at all is 'never', and is skipped entirely when not connected", () => {
    const out = computeFreshness([conn()], [], NOW);
    expect(out).toEqual([expect.objectContaining({ integrationId: "int-1", state: "never", ageHours: null })]);
    expect(computeFreshness([conn({ status: "disconnected" })], [], NOW)).toEqual([]);
  });
  it("a recent good run is fresh; one older than 26h is stale regardless of cadence", () => {
    const fresh = computeFreshness([conn()], [run({ startedAt: ago(2) })], NOW);
    expect(fresh[0]).toMatchObject({ state: "fresh", ageHours: 2 });
    const stale = computeFreshness([conn()], [run({ startedAt: ago(30) })], NOW);
    expect(stale[0]).toMatchObject({ state: "stale", ageHours: 30 });
  });
  it("late means behind the stream's own cadence, before the 26h stale threshold", () => {
    // Cadence 3h, age 7h: more than double the cadence but well under 26h.
    const out = computeFreshness([conn()], [run({ startedAt: ago(7) })], NOW, () => 3);
    expect(out[0]).toMatchObject({ state: "late", cadenceHours: 3 });
  });
  it("a run still 'running' past the in-flight grace period counts as neither good nor failed", () => {
    const out = computeFreshness([conn()], [run({ status: "running", startedAt: ago(0.5) }), run({ status: "success", startedAt: ago(5) })], NOW);
    expect(out[0]).toMatchObject({ state: "fresh", ageHours: 5, lastStatus: "running" }); // most recent row (even if running) drives lastStatus
  });
  it("consecutive failures count from the most recent settled run backwards, stopping at the first non-failure", () => {
    const out = computeFreshness([conn()], [
      run({ status: "failed", startedAt: ago(1) }), run({ status: "failed", startedAt: ago(2) }), run({ status: "success", startedAt: ago(3) }), run({ status: "failed", startedAt: ago(4) }),
    ], NOW);
    expect(out[0].consecutiveFailures).toBe(2);
  });
  it("alertable only for a live, connected run; sandbox and showcase connections never alert", () => {
    const live = computeFreshness([conn()], [run({ mode: "live" })], NOW);
    expect(live[0]).toMatchObject({ alertable: true, mode: "live" });
    const sandbox = computeFreshness([conn()], [run({ mode: "sandbox" })], NOW);
    expect(sandbox[0]).toMatchObject({ alertable: false, mode: "sandbox" });
    const notConnected = computeFreshness([conn({ status: "needs_attention" })], [run({ mode: "live" })], NOW);
    expect(notConnected[0]).toMatchObject({ alertable: false });
  });
  it("splits multiple streams of the same connector into separate rows, each with its own key", () => {
    const out = computeFreshness([conn()], [run({ stream: "leads", startedAt: ago(1) }), run({ stream: "messages", startedAt: ago(9) })], NOW);
    expect(out.map((o) => o.key).sort()).toEqual(["int-1:leads", "int-1:messages"]);
  });
  it("sorts by age descending (stalest first), with never-run connectors first", () => {
    const out = computeFreshness(
      [conn({ id: "a" }), conn({ id: "b" }), conn({ id: "c" })],
      [run({ integrationId: "a", startedAt: ago(2) }), run({ integrationId: "b", startedAt: ago(20) })],
      NOW,
    );
    expect(out.map((o) => o.integrationId)).toEqual(["c", "b", "a"]);
  });
});

describe("cadenceFromCron", () => {
  it("returns the hours between two consecutive scheduled runs", () => {
    const nextCronRun = (_e: string, _tz: string, after: number) => after + 3 * H;
    expect(cadenceFromCron("0 */3 * * *", "Asia/Kolkata", nextCronRun, NOW)).toBe(3);
  });
  it("returns null when the cron cannot be evaluated or throws", () => {
    expect(cadenceFromCron("bad", "Asia/Kolkata", () => null, NOW)).toBeNull();
    expect(cadenceFromCron("bad", "Asia/Kolkata", () => { throw new Error("boom"); }, NOW)).toBeNull();
  });
});
