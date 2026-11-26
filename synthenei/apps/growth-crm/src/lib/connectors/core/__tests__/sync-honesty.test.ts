// AUD-028: the run history must not lie. A skipped run is never "success", an empty answer says why, a crashed run is closed.
import { beforeEach, describe, expect, it } from "vitest";
import { connectWithCredentials } from "../lifecycle";
import { MOCK_VALID_KEY, mockConnector } from "../mock";
import { RUNNING_STALE_MS, runSync } from "../sync";
import { registerConnector, resetRegistry } from "../../registry";
import type { ConnectorDef, SyncResult } from "../types";
import { ACTOR, makeDeps } from "./fakes";

beforeEach(() => resetRegistry());

async function ready(result: SyncResult | (() => Promise<SyncResult>)) {
  const def: ConnectorDef = { ...mockConnector, streams: [{ key: "s", run: async () => (typeof result === "function" ? result() : result) }] };
  registerConnector(def);
  const t = makeDeps();
  await connectWithCredentials(t.deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
  return { ...t, conn: [...t.store.conns.values()][0]! };
}
const base = { cursor: null, rowsIn: 0, rowsRejected: 0, done: true };

describe("honest run status", () => {
  it("a stream that did not run is 'skipped' with its reason, not success, and does not move last_sync_at", async () => {
    const { deps, store, conn } = await ready({ ...base, status: "skipped", reason: "missing_scopes:read_insights" });
    const out = await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    expect(out.streams[0]).toMatchObject({ status: "skipped" });
    expect(store.runs[0]).toMatchObject({ status: "skipped", error: "Skipped: missing_scopes:read_insights" });
    expect(conn.lastSyncAt ?? null).toBeNull();
  });
  it("zero rows with no_data is a success that says 'No data' and why", async () => {
    const { deps, store, conn } = await ready({ ...base, status: "no_data", reason: "no_ad_insights_for_window" });
    const out = await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    expect(out.streams[0]).toMatchObject({ status: "success", noData: true });
    expect(store.runs[0]!.error).toBe("No data: no_ad_insights_for_window");
  });
  it("a stream that stopped early is partial even with no rejected rows", async () => {
    const { deps, store, conn } = await ready({ ...base, rowsIn: 5, status: "partial", reason: "rate_limited_or_page_cap" });
    const out = await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    expect(out.streams[0]!.status).toBe("partial");
    expect(store.runs[0]!.error).toContain("rate_limited_or_page_cap");
  });
  it("plain results stay success", async () => {
    const { deps, store, conn } = await ready({ ...base, rowsIn: 3 });
    expect((await runSync(deps, { connectionId: conn.id, trigger: "poll" })).streams[0]!.status).toBe("success");
    expect(store.runs[0]!.error).toBeNull();
  });
  it("a run left 'running' by a crashed worker is closed as failed instead of blocking the stream for ever", async () => {
    const { deps, store, conn } = await ready({ ...base, rowsIn: 1 });
    const old = new Date(Date.now() - RUNNING_STALE_MS - 60_000).toISOString();
    store.runs.push({ id: 99, connectionId: conn.id, stream: "s", kind: "poll", status: "running", startedAt: old, finishedAt: null, rowsIn: 0, rowsOut: 0, rowsRejected: 0, error: null, payloadSample: null, tenantId: "t-1", mode: "sandbox" });
    const out = await runSync(deps, { connectionId: conn.id, trigger: "poll" });
    expect(store.runs.find((r) => r.id === 99)!.status).toBe("failed");
    expect(out.streams[0]!.status).toBe("success");   // the stream ran again
  });
});
