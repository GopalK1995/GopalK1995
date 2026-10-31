import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@/lib/db/client";
import { createEndpoint, replayDelivery, rotateSecret, toView } from "../admin";
import { joinEventTypes } from "../options";
import { checkUrl, endpointInput } from "../schemas";
import type { WebhookStore } from "../store";
import type { EndpointRow } from "../types";

type Call = { table: string; op: string; arg?: unknown };
/** Request-client double: records writes, answers selects from a table map. */
function reqDb(tables: Record<string, unknown>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    let op = "select", arg: unknown;
    const q: Record<string, unknown> = {};
    const result = () => ({ data: tables[table + ":" + op] ?? tables[table] ?? null, error: null });
    for (const m of ["eq", "order", "limit"]) q[m] = () => q;
    q.select = () => q;
    q.insert = (v: unknown) => { op = "insert"; arg = v; return q; };
    q.update = (v: unknown) => { op = "update"; arg = v; return q; };
    q.maybeSingle = () => { calls.push({ table, op, arg }); return Promise.resolve(result()); };
    q.single = () => { calls.push({ table, op, arg }); return Promise.resolve(result()); };
    q.then = (res: (v: unknown) => unknown) => { calls.push({ table, op, arg }); return Promise.resolve(result()).then(res); };
    return q;
  };
  return { db: { from } as unknown as Db, calls };
}
function svcDb() {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  let n = 0;
  const rpc = async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return { data: fn === "vault_put_secret" ? `vault-${++n}` : fn === "queue_send" ? 9 : null, error: null }; };
  return { db: { rpc } as unknown as Db, rpcs };
}
const row = (over: Record<string, unknown> = {}) => ({ id: "ep-1", tenant_id: "t-1", workspace_id: "w-1", url: "https://hooks.example.com/in", description: null, event_types: ["lead.*"], secret_id: "vault-old", previous_secret_id: null, secret_rotated_at: null, active: true, disabled_reason: null, consecutive_failures: 0, created_by: "u-1", created_at: "2026-10-01T00:00:00Z", ...over });
const ep = (over: Partial<EndpointRow> = {}): EndpointRow => ({ id: "ep-1", tenantId: "t-1", workspaceId: "w-1", url: "https://hooks.example.com/in", description: null, eventTypes: ["lead.*"], secretId: "vault-old", previousSecretId: null, secretRotatedAt: null, active: true, disabledReason: null, consecutiveFailures: 0, createdBy: "u-1", createdAt: "2026-10-01T00:00:00Z", ...over });

describe("endpoint lifecycle", () => {
  it("create returns the secret once, stores only the vault id, and never selects the secret back", async () => {
    const req = reqDb({ "webhook_endpoints": [], "webhook_endpoints:insert": row({ secret_id: "vault-1" }) });
    const svc = svcDb();
    const out = await createEndpoint(req.db, svc.db, { tenantId: "t-1", workspaceId: "w-1", createdBy: "u-1", url: "https://hooks.example.com/in", description: null, eventTypes: ["lead.*"], options: { pii: false, filters: [] } });
    expect(out.secret).toMatch(/^whsec_/);
    const vaultPut = svc.rpcs.find((r) => r.fn === "vault_put_secret")!;
    expect(vaultPut.args.p_secret).toBe(out.secret);
    const insert = req.calls.find((c) => c.op === "insert")!;
    expect(JSON.stringify(insert.arg)).not.toContain(out.secret);
    expect(insert.arg).toMatchObject({ secret_id: "vault-1", url: "https://hooks.example.com/in" });
    expect(JSON.stringify(toView(out.endpoint))).not.toMatch(/whsec_|vault-/);
  });

  it("rotation moves the current secret to previous, stamps the time, and returns a 24 h grace end", async () => {
    const req = reqDb({ "webhook_endpoints:update": { id: "ep-1" } });
    const svc = svcDb();
    const out = await rotateSecret(req.db, svc.db, "w-1", ep({ secretId: "vault-cur", previousSecretId: "vault-older" }));
    const upd = req.calls.find((c) => c.op === "update")!.arg as Record<string, unknown>;
    expect(upd).toMatchObject({ secret_id: "vault-1", previous_secret_id: "vault-cur" });
    expect(typeof upd.secret_rotated_at).toBe("string");
    expect(JSON.stringify(upd)).not.toContain(out.secret);
    expect(svc.rpcs.filter((r) => r.fn === "vault_delete_secret").map((r) => r.args.p_id)).toEqual(["vault-older"]);
    expect(Date.parse(out.graceUntil) - Date.parse(upd.secret_rotated_at as string)).toBe(24 * 3600 * 1000);
  });

  it("view exposes the grace window but no secret ids", () => {
    const v = toView(ep({ previousSecretId: "vault-prev", secretRotatedAt: new Date(Date.now() - 3600_000).toISOString(), eventTypes: joinEventTypes(["lead.*"], { pii: true, filters: [{ field: "stage", values: ["won"] }] }) }));
    expect(v).toMatchObject({ eventTypes: ["lead.*"], includePii: true, filters: [{ field: "stage", values: ["won"] }] });
    expect(v.graceUntil).not.toBeNull();
    expect(JSON.stringify(v)).not.toMatch(/vault-/);
  });
});

describe("replay", () => {
  const store = (eventExists: boolean): WebhookStore => ({
    event: async () => (eventExists ? ({ occurred_at: "2026-11-01T11:59:00Z" } as never) : null),
    insertDelivery: async (d: { endpointId: string; eventId: string | null; eventType: string }) => ({ id: 77, createdAt: "x", endpointId: d.endpointId, eventId: d.eventId, eventType: d.eventType, attempt: 1, status: "pending", responseStatus: null, responseMs: null, responseExcerpt: null, nextAttemptAt: null }),
  } as unknown as WebhookStore);
  const deliveries = { webhook_deliveries: [{ id: 5, created_at: "2026-11-01T12:00:00Z", endpoint_id: "ep-1", event_id: "100", event_type: "lead.updated", attempt: 7, status: "dead", response_status: null, response_ms: null, response_excerpt: null, next_attempt_at: null }, { id: 6, created_at: "2026-11-01T12:01:00Z", endpoint_id: "ep-1", event_id: null, event_type: "webhook.test", attempt: 1, status: "dead", response_status: null, response_ms: null, response_excerpt: null, next_attempt_at: null }] };

  it("queues a fresh delivery row for the same event", async () => {
    const svc = svcDb();
    const r = await replayDelivery(reqDb(deliveries).db, svc.db, ep(), 5, store(true));
    expect(r).toEqual({ ok: true, deliveryId: 77 });
    const sent = svc.rpcs.find((x) => x.fn === "queue_send")!.args;
    expect(sent.p_queue).toBe("webhook_out");
    expect(sent.p_msg).toMatchObject({ kind: "webhook.deliver", tenant_id: "t-1", payload: { event_id: "100", endpoint_id: "ep-1", delivery_id: 77, replay: true, dedupe: "wh-replay:77" } });
  });
  it("refuses unknown deliveries, test events, paused endpoints and events past retention, without queueing", async () => {
    const svc = svcDb();
    expect(await replayDelivery(reqDb(deliveries).db, svc.db, ep(), 999, store(true))).toEqual({ ok: false, reason: "not_found" });
    expect(await replayDelivery(reqDb(deliveries).db, svc.db, ep(), 6, store(true))).toEqual({ ok: false, reason: "test_event" });
    expect(await replayDelivery(reqDb(deliveries).db, svc.db, ep({ active: false }), 5, store(true))).toEqual({ ok: false, reason: "paused" });
    expect(await replayDelivery(reqDb(deliveries).db, svc.db, ep(), 5, store(false))).toEqual({ ok: false, reason: "event_gone" });
    expect(svc.rpcs.filter((x) => x.fn === "queue_send")).toHaveLength(0);
  });
});

describe("input validation and create-time SSRF", () => {
  it("rejects private, http and credentialed URLs with a stable error key", async () => {
    const pub = async () => ["93.184.216.34"];
    expect(await checkUrl("https://hooks.example.com/x", pub)).toBeNull();
    expect(await checkUrl("http://hooks.example.com/x", pub)).toBe("urlHttps");
    expect(await checkUrl("https://u:p@hooks.example.com/x", pub)).toBe("urlCredentials");
    expect(await checkUrl("https://10.0.0.1/x", pub)).toBe("urlBlocked");
    expect(await checkUrl("https://169.254.169.254/x", pub)).toBe("urlBlocked");
    expect(await checkUrl("https://evil.example.com/x", async () => ["192.168.1.1"])).toBe("urlBlocked");
  });
  it("accepts catalogue webhook events and wildcards, rejects unknown or non-webhook types", () => {
    const base = { url: "https://hooks.example.com/x", eventTypes: ["lead.created"] };
    expect(endpointInput.safeParse(base).success).toBe(true);
    expect(endpointInput.safeParse({ ...base, eventTypes: ["lead.*", "*"] }).success).toBe(true);
    expect(endpointInput.safeParse({ ...base, eventTypes: ["nope.created"] }).success).toBe(false);
    expect(endpointInput.safeParse({ ...base, eventTypes: ["webhook.endpoint.disabled"] }).success).toBe(false);
    expect(endpointInput.safeParse({ ...base, eventTypes: [] }).success).toBe(false);
  });
});
