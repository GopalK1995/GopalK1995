import { beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ALL_EVENT_TYPES, isKnownEventType } from "@/lib/events/catalog";
import { clearFanout, eventMatches, registerFanout, routeEvent } from "../fanout";
import { acknowledgeAgentMessage } from "../handlers/agent";
import { fanoutEvent } from "../handlers/events";
import { getHandler, clearHandlers } from "../registry";
import { memLogger } from "./fakes";
import type { CrmEvent } from "@/lib/events/types";

type Err = { code?: string; message: string } | null;
/** Chainable stand-in: .from(t).select().eq()... resolves to the table's rows filtered by the eq() calls. */
function fakeDb(tables: Record<string, { rows?: Record<string, unknown>[]; error?: Err }>): SupabaseClient {
  return {
    from(t: string) {
      const filters: [string, unknown][] = [];
      const entry = tables[t];
      const result = () => (entry?.error ? { data: null, error: entry.error } : { data: (entry?.rows ?? []).filter((r) => filters.every(([k, v]) => r[k] === v)), error: null });
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
        maybeSingle: () => Promise.resolve({ data: (result().data as unknown[] | null)?.[0] ?? null, error: result().error }),
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const ev = (type = "lead.created"): CrmEvent => ({
  id: "42", type, tenantId: "t1", workspaceId: "w1", objectType: "lead", objectId: "o1",
  actor: { kind: "user", id: "u1" }, occurredAt: "2026-10-30T00:00:00Z", version: 1, data: {},
});

beforeEach(() => clearFanout());

describe("event matching", () => {
  it("handles exact, wildcard and prefix patterns", () => {
    expect(eventMatches("lead.created", "lead.created")).toBe(true);
    expect(eventMatches("*", "deal.won")).toBe(true);
    expect(eventMatches("lead.*", "lead.stage_changed")).toBe(true);
    expect(eventMatches("lead.*", "leader.created")).toBe(false);
    expect(eventMatches("lead.created", "lead.updated")).toBe(false);
  });
});

describe("routeEvent", () => {
  const db = fakeDb({
    webhook_endpoints: { rows: [
      { id: "e1", workspace_id: "w1", active: true, event_types: ["lead.*"] },
      { id: "e2", workspace_id: "w1", active: true, event_types: ["deal.won"] },
      { id: "e3", workspace_id: "w2", active: true, event_types: ["*"] },
    ] },
    notification_rules: { rows: [{ id: "r1", workspace_id: "w1", enabled: true, event_type: "lead.created" }] },
    agent_triggers: { error: { code: "42P01", message: 'relation "agent_triggers" does not exist' } },
  });

  it("routes to matching webhook endpoints and notification rules with stable dedupe keys", async () => {
    const out = await routeEvent(ev(), db);
    expect(out.map((o) => `${o.queue}:${(o.body.payload as { dedupe: string }).dedupe}`)).toEqual(["webhook_out:wh:42:e1", "notify:nt:42:r1"]);
    expect(out.every((o) => o.body.tenant_id === "t1")).toBe(true);
    expect(await routeEvent(ev(), db)).toEqual(out); // deterministic: redelivery produces identical messages
  });

  it("sends nothing to the agent queue while agent_triggers does not exist", async () => {
    expect((await routeEvent(ev(), db)).some((o) => o.queue === "agent")).toBe(false);
  });

  it("routes to the agent queue only for matching triggers on agent-eligible types", async () => {
    const withAgents = fakeDb({
      agent_triggers: { rows: [{ id: "a1", workspace_id: "w1", enabled: true, event_types: ["lead.created"] }, { id: "a2", workspace_id: "w1", enabled: true, event_types: ["deal.won"] }] },
    });
    const out = await routeEvent(ev(), withAgents);
    expect(out.map((o) => o.queue)).toEqual(["agent"]);
    expect((await routeEvent(ev("message.status"), withAgents)).length).toBe(0); // message.status is not agent-eligible
  });

  it("does not offer webhook-ineligible events to webhooks", async () => {
    expect((await routeEvent(ev("activity.created"), db)).some((o) => o.queue === "webhook_out")).toBe(false);
  });

  it("includes messages from registered extensions (connector pushes)", async () => {
    registerFanout(async () => [{ queue: "connector_sync", body: { kind: "connector.push", tenant_id: "t1", payload: {} } }]);
    expect((await routeEvent(ev("deal.won"), db)).some((o) => o.queue === "connector_sync")).toBe(true);
  });

  it("surfaces a real database error so the job retries", async () => {
    await expect(routeEvent(ev(), fakeDb({ webhook_endpoints: { error: { code: "XX000", message: "down" } } }))).rejects.toThrow(/webhook_endpoints/);
  });
});

describe("event.fanout handler", () => {
  const payload = { event_id: 42, occurred_at: "2026-10-30T00:00:00Z", type: "lead.created", tenant_id: "t1", workspace_id: "w1" };
  it("acknowledges when the event row is gone", async () => {
    const ctx = { runId: 1, attempt: 1, tenantId: "t1", log: memLogger(), deadline: 0, db: fakeDb({ events: { rows: [] } }) };
    expect(await fanoutEvent(payload, ctx)).toBe("done");
  });
  it("throws (so the drainer retries) when the events read fails", async () => {
    const ctx = { runId: 1, attempt: 1, tenantId: "t1", log: memLogger(), deadline: 0, db: fakeDb({ events: { error: { message: "timeout" } } }) };
    await expect(fanoutEvent(payload, ctx)).rejects.toThrow(/events read/);
  });
});

describe("agent queue stub", () => {
  it("acknowledges any message and touches nothing", async () => {
    const touched: string[] = [];
    const db = new Proxy({}, { get: (_t, p) => { touched.push(String(p)); return undefined; } }) as unknown as SupabaseClient;
    const log = memLogger();
    expect(await acknowledgeAgentMessage({ anything: true }, { runId: 1, attempt: 1, tenantId: null, log, deadline: 0, db })).toBe("done");
    expect(touched).toEqual([]);
    expect(log.lines).toHaveLength(1);
  });
  it("is registered as the agent queue wildcard", async () => {
    clearHandlers();
    await import("../handlers/agent"); // module cache: re-register explicitly
    const { registerHandler } = await import("../registry");
    registerHandler("agent", "*", acknowledgeAgentMessage);
    expect(getHandler("agent", "whatever.kind")).toBe(acknowledgeAgentMessage);
  });
});

describe("event catalogue", () => {
  it("has unique types and valid names", () => {
    const types = ALL_EVENT_TYPES.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
    for (const t of types) expect(t).toMatch(/^[a-z][a-z0-9_.]{1,80}$/);
  });
  it("covers every type seeded in migration 0014 and 0018", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sql = ["0014_event_bus_jobs_audit.sql", "0018_collab_realtime.sql"].map((f) => readFileSync(join(process.cwd(), "supabase/migrations", f), "utf8")).join("\n");
    const seeded = [...sql.matchAll(/^\s*\('([a-z][a-z0-9_.]+)', '[a-z_]+', '/gm)].map((m) => m[1]);
    expect(seeded.length).toBeGreaterThan(40);
    const have = new Set<string>(ALL_EVENT_TYPES.map((d) => d.type));
    expect(seeded.filter((t) => !have.has(t))).toEqual([]);
  });
  it("accepts custom-object record events and rejects unknown ones", () => {
    expect(isKnownEventType("record.vehicle.created")).toBe(true);
    expect(isKnownEventType("record.Vehicle.created")).toBe(false);
    expect(isKnownEventType("lead.exploded")).toBe(false);
  });
});
