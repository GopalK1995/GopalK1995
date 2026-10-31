import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/service", () => ({ serviceDb: () => ({}) }));
const enqueued: { queue: string; kind: string; payload: Record<string, unknown> }[] = [];
vi.mock("@/lib/jobs/registry", async (orig) => {
  const real = await orig<typeof import("@/lib/jobs/registry")>();
  return { ...real, enqueue: async (queue: string, kind: string, payload: Record<string, unknown>) => { enqueued.push({ queue, kind, payload }); return enqueued.length; } };
});

import { CONNECTOR_KIND, routeConnectorPushes, scanHandler, setRuntimeFactory, syncHandler } from "../jobs";
import { getHandler } from "@/lib/jobs/registry";
import { connectWithCredentials } from "../lifecycle";
import { MOCK_VALID_KEY } from "../mock";
import { resetRegistry } from "../../registry";
import { ACTOR, makeDeps } from "./fakes";
import type { JobContext } from "@/lib/jobs/registry";

const jobCtx = (): JobContext => ({ runId: 1, attempt: 1, tenantId: "t-1", log: { info() {}, warn() {}, error() {} }, deadline: Date.now() + 60_000, db: {} as never });

beforeEach(() => { resetRegistry(); enqueued.length = 0; setRuntimeFactory(null); });

async function connected() {
  const t = makeDeps();
  await connectWithCredentials(t.deps, ACTOR, "mock", { api_key: MOCK_VALID_KEY });
  setRuntimeFactory(() => t.deps);
  return { ...t, conn: [...t.store.conns.values()][0] };
}

describe("connector job handlers", () => {
  it("registers scan, sync, push and refresh on connector_sync", () => {
    for (const k of Object.values(CONNECTOR_KIND)) expect(getHandler("connector_sync", k)).toBeTypeOf("function");
  });
  it("sync handler runs the stream and acks", async () => {
    const { conn, store } = await connected();
    expect(await syncHandler({ connection_id: conn.id, trigger: "poll" }, jobCtx())).toBe("done");
    expect(store.runs).toHaveLength(1);
  });
  it("scan enqueues a due stream once per cron slot (dedupe key carries the slot) and nothing for a fresh one", async () => {
    const { conn } = await connected();
    conn.lastSyncAt = "2020-01-01T00:00:00Z";
    await scanHandler({}, jobCtx());
    const syncs = enqueued.filter((e) => e.kind === CONNECTOR_KIND.sync);
    expect(syncs).toHaveLength(1);
    expect(String(syncs[0].payload.dedupe)).toMatch(new RegExp(`^sync:${conn.id}:contacts:\\d+$`));
    enqueued.length = 0;
    conn.lastSyncAt = new Date().toISOString();
    await scanHandler({}, jobCtx());
    expect(enqueued.filter((e) => e.kind === CONNECTOR_KIND.sync)).toHaveLength(0);
  });
  it("event fan-out routes lead events to matching pushes in the same workspace only", async () => {
    const { conn } = await connected();
    const ev = { id: "e1", type: "lead.created", tenantId: "t-1", workspaceId: "w-1", objectType: "lead", objectId: "lead-1" };
    const out = await routeConnectorPushes(ev, {} as never);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ queue: "connector_sync", body: { kind: CONNECTOR_KIND.push, payload: { connection_id: conn.id, push: "send_message", lead_ids: ["lead-1"], dedupe: `cp:e1:${conn.id}:send_message` } } });
    expect(await routeConnectorPushes({ ...ev, workspaceId: "w-2" }, {} as never)).toEqual([]);
    expect(await routeConnectorPushes({ ...ev, type: "deal.won" }, {} as never)).toEqual([]);
    expect(await routeConnectorPushes({ ...ev, objectType: "deal" }, {} as never)).toEqual([]);
  });
});
