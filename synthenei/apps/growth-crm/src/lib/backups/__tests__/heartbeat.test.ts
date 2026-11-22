import { describe, expect, it } from "vitest";
import { runHeartbeat } from "../heartbeat";
import { FakeStore, mkWs } from "./fake-store";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");

describe("runHeartbeat", () => {
  it("writes one success row per workspace that counted at least one table, plus a project-wide row", () => {
    const store = new FakeStore();
    store.wss = [mkWs("ws-1", "t-1"), mkWs("ws-2", "t-1")];
    store.counts = { "ws-1": { leads: 10, contacts: 5 }, "ws-2": { leads: 3 } };
    return runHeartbeat(store, { now: NOW }).then((r) => {
      expect(r).toMatchObject({ workspaces: 2, written: 2, failed: 0, projectRow: true, schemaHash: "fake-hash" });
      const perWs = store.checksList.filter((c) => c.workspaceId !== null);
      expect(perWs).toHaveLength(2);
      expect(perWs.every((c) => c.status === "success")).toBe(true);
      const project = store.checksList.find((c) => c.workspaceId === null);
      expect(project).toMatchObject({ status: "success", kind: "heartbeat" });
      expect((project!.rowCounts as { tenants: Record<string, unknown> }).tenants["t-1"]).toMatchObject({ workspaces: 2, counts: { leads: 13, contacts: 5 } });
    });
  });

  it("a workspace where every table is uncountable is written as failed, but does not stop the others", () => {
    const store = new FakeStore();
    store.wss = [mkWs("ws-1", "t-1"), mkWs("ws-2", "t-1")];
    store.counts = { "ws-1": { leads: null, contacts: null }, "ws-2": { leads: 7 } };
    return runHeartbeat(store, { now: NOW }).then((r) => {
      expect(r).toMatchObject({ workspaces: 2, written: 2, failed: 0 }); // "written" counts the row being written at all, failed-table is reflected in status
      const ws1 = store.checksList.find((c) => c.workspaceId === "ws-1")!;
      expect(ws1).toMatchObject({ status: "failed", detail: "No table could be counted." });
    });
  });

  it("scoping to one workspace skips the others and never writes the project-wide row", () => {
    const store = new FakeStore();
    store.wss = [mkWs("ws-1", "t-1"), mkWs("ws-2", "t-1")];
    store.counts = { "ws-1": { leads: 10 } };
    return runHeartbeat(store, { now: NOW, workspaceId: "ws-1" }).then((r) => {
      expect(r).toMatchObject({ workspaces: 1, written: 1, projectRow: false });
      expect(store.checksList.filter((c) => c.workspaceId === "ws-2")).toHaveLength(0);
      expect(store.checksList.find((c) => c.workspaceId === null)).toBeUndefined();
    });
  });

  it("a workspace whose insert throws is counted as failed without aborting the run", () => {
    const store = new FakeStore();
    store.wss = [mkWs("ws-1", "t-1"), mkWs("ws-2", "t-1")];
    store.counts = { "ws-1": { leads: 10 }, "ws-2": { leads: 5 } };
    const realInsert = store.insertCheck.bind(store);
    store.insertCheck = async (c) => { if (c.workspaceId === "ws-1") throw new Error("db down"); return realInsert(c); };
    return runHeartbeat(store, { now: NOW }).then((r) => {
      expect(r.written).toBe(1);
      expect(r.failed).toBe(1);
    });
  });
});
