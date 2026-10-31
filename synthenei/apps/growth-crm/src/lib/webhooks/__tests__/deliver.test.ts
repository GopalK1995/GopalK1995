import { describe, expect, it, vi } from "vitest";
import type { EventRow } from "@/lib/events/types";
import { RETRY_SCHEDULE_SECONDS } from "../backoff";
import { processDelivery, sendTestEvent, type DeliverDeps } from "../deliver";
import { joinEventTypes } from "../options";
import type { SendResult } from "../send";
import { generateSecret, verifySignature } from "../signing";
import type { DeliveryPatch, NewDelivery, WebhookStore } from "../store";
import type { DeliverPayload, DeliveryRow, EndpointRow } from "../types";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const WS = "w-1";
const SECRET_A = generateSecret();
const SECRET_B = generateSecret();

function endpoint(over: Partial<EndpointRow> = {}): EndpointRow {
  return {
    id: "ep-1", tenantId: "t-1", workspaceId: WS, url: "https://hooks.example.com/in", description: null, eventTypes: ["lead.*"], secretId: "sec-a", previousSecretId: null,
    secretRotatedAt: null, active: true, disabledReason: null, consecutiveFailures: 0, createdBy: "u-1", createdAt: "2026-10-01T00:00:00Z", ...over,
  };
}
const EVENT: EventRow = { id: "100", tenant_id: "t-1", workspace_id: WS, type: "lead.updated", object_type: "lead", object_id: "l-1", actor_kind: "user", actor_id: "u-1", occurred_at: "2026-11-01T11:59:00Z", data: { changed_fields: ["stage", "email"], after: { stage: "won", email: "ana@example.com" } } };

function fakeStore(e: EndpointRow | null, opts: { event?: EventRow | null; pii?: boolean; lastSuccess?: string | null; owners?: string[] } = {}) {
  const state = { endpoint: e, rows: [] as DeliveryRow[], failures: e?.consecutiveFailures ?? 0, disabled: null as string | null, notified: [] as string[], seq: 0 };
  const store: WebhookStore = {
    endpoint: async (id, ws) => (state.endpoint && state.endpoint.id === id && state.endpoint.workspaceId === ws ? { ...state.endpoint, consecutiveFailures: state.failures, active: state.disabled ? false : state.endpoint.active } : null),
    secret: async (id) => ({ "sec-a": SECRET_A, "sec-b": SECRET_B })[id] ?? null,
    event: async () => (opts.event === undefined ? EVENT : opts.event),
    deliveryById: async (id) => state.rows.find((r) => r.id === id) ?? null,
    latestDelivery: async (_ep, ev) => [...state.rows].reverse().find((r) => r.eventId === ev) ?? null,
    insertDelivery: async (d: NewDelivery) => {
      const row: DeliveryRow = { id: ++state.seq, createdAt: "2026-11-01T12:00:00Z", endpointId: d.endpointId, eventId: d.eventId, eventType: d.eventType, attempt: d.attempt, status: d.status, responseStatus: null, responseMs: null, responseExcerpt: null, nextAttemptAt: null };
      state.rows.push(row);
      return row;
    },
    updateDelivery: async (id, _c, p: DeliveryPatch) => { const r = state.rows.find((x) => x.id === id)!; Object.assign(r, p); },
    lastSuccessAt: async () => opts.lastSuccess ?? null,
    setFailures: async (_id, n) => { state.failures = n; },
    disable: async (_id, reason) => { state.disabled = reason; },
    ownerIds: async () => opts.owners ?? ["o-1", "o-2"],
    notifyOwners: async (_e, owners) => { state.notified.push(...owners); },
    creatorHoldsPii: async () => opts.pii ?? false,
  };
  return { store, state };
}

const okRes: SendResult = { ok: true, status: 200, ms: 40, excerpt: "ok", kind: null };
const failRes = (status = 500): SendResult => ({ ok: false, status, ms: 90, excerpt: "boom", kind: "http" });
const payload = (over: Partial<DeliverPayload> = {}): DeliverPayload => ({ event_id: "100", occurred_at: EVENT.occurred_at, endpoint_id: "ep-1", workspace_id: WS, type: "lead.updated", dedupe: "wh:100:ep-1", ...over });

function harness(e: EndpointRow | null, res: SendResult | ((n: number) => SendResult) = okRes, opts: Parameters<typeof fakeStore>[1] = {}) {
  const f = fakeStore(e, opts);
  const sent: { url: string; body: string; headers: Record<string, string> }[] = [];
  const queued: { payload: DeliverPayload; delay: number; tenantId: string }[] = [];
  const logs: string[] = [];
  const deps: DeliverDeps = {
    store: f.store, now: () => NOW, rand: () => 0.5,
    send: async (a) => { sent.push(a); return typeof res === "function" ? res(sent.length) : res; },
    enqueue: async (p, delay, tenantId) => { queued.push({ payload: p, delay, tenantId }); },
    emitDisabled: vi.fn(async () => undefined),
    log: { info: (m, x) => logs.push(m + JSON.stringify(x ?? {})), warn: (m, x) => logs.push(m + JSON.stringify(x ?? {})) },
  };
  return { ...f, deps, sent, queued, logs };
}

describe("webhook.deliver", () => {
  it("signs and delivers the envelope, logs the attempt and resets the failure streak", async () => {
    const h = harness(endpoint({ consecutiveFailures: 3 }));
    expect(await processDelivery(payload(), h.deps)).toBe("done");
    expect(h.sent).toHaveLength(1);
    const { body, headers } = h.sent[0];
    expect(headers["webhook-id"]).toBe("100");
    expect(verifySignature(SECRET_A, headers, body, Math.floor(NOW / 1000))).toBe(true);
    const env = JSON.parse(body);
    expect(env).toMatchObject({ id: "100", type: "lead.updated", org_id: "t-1", workspace_id: WS });
    expect(h.state.rows[0]).toMatchObject({ status: "succeeded", attempt: 1, responseStatus: 200, responseMs: 40 });
    expect(h.state.failures).toBe(0);
  });

  it("excludes PII by default, and still excludes it when the creator no longer holds pii.read", async () => {
    const e = endpoint({ eventTypes: joinEventTypes(["lead.*"], { pii: true, filters: [] }) });
    const noPii = harness(endpoint(), okRes, { pii: true });
    await processDelivery(payload(), noPii.deps);
    expect(noPii.sent[0].body).not.toMatch(/ana@example\.com|email/);
    const revoked = harness(e, okRes, { pii: false });
    await processDelivery(payload(), revoked.deps);
    expect(revoked.sent[0].body).not.toMatch(/ana@example\.com/);
    const allowed = harness(e, okRes, { pii: true });
    await processDelivery(payload(), allowed.deps);
    expect(allowed.sent[0].body).toMatch(/ana@example\.com/);
  });

  it("signs with both secrets inside the 24 h rotation grace and only the new one after", async () => {
    const inside = harness(endpoint({ previousSecretId: "sec-b", secretRotatedAt: new Date(NOW - 3600_000).toISOString() }));
    await processDelivery(payload(), inside.deps);
    const hd = inside.sent[0].headers;
    expect(hd["webhook-signature"].split(" ")).toHaveLength(2);
    expect(verifySignature(SECRET_A, hd, inside.sent[0].body, Math.floor(NOW / 1000))).toBe(true);
    expect(verifySignature(SECRET_B, hd, inside.sent[0].body, Math.floor(NOW / 1000))).toBe(true);
    const after = harness(endpoint({ previousSecretId: "sec-b", secretRotatedAt: new Date(NOW - 25 * 3600_000).toISOString() }));
    await processDelivery(payload(), after.deps);
    expect(after.sent[0].headers["webhook-signature"].split(" ")).toHaveLength(1);
    expect(verifySignature(SECRET_B, after.sent[0].headers, after.sent[0].body, Math.floor(NOW / 1000))).toBe(false);
  });

  it("retries on the schedule with attempt+1, then marks dead after the seventh attempt", async () => {
    const h = harness(endpoint(), failRes());
    let p = payload();
    const delays: number[] = [];
    for (let i = 1; i <= 7; i++) {
      await processDelivery(p, h.deps);
      if (i < 7) {
        const q = h.queued[h.queued.length - 1];
        expect(q.payload.attempt).toBe(i + 1);
        expect(q.tenantId).toBe("t-1");
        delays.push(q.delay);
        p = q.payload;
        expect(h.state.rows[0]).toMatchObject({ status: "failed", attempt: i });
        expect(h.state.rows[0].nextAttemptAt).toBe(new Date(NOW + q.delay * 1000).toISOString());
      }
    }
    expect(delays).toEqual([...RETRY_SCHEDULE_SECONDS]);
    expect(h.state.rows).toHaveLength(1);
    expect(h.state.rows[0]).toMatchObject({ status: "dead", attempt: 7, nextAttemptAt: null });
    expect(h.queued).toHaveLength(6);
    expect(h.state.failures).toBe(7);
  });

  it("is idempotent: redelivery of a finished event or of an attempt that already ran sends nothing", async () => {
    const h = harness(endpoint());
    await processDelivery(payload(), h.deps);
    await processDelivery(payload(), h.deps); // same dedupe, queue redelivery
    expect(h.sent).toHaveLength(1);
    const f = harness(endpoint(), failRes());
    await processDelivery(payload(), f.deps);
    await processDelivery(payload(), f.deps); // duplicate copy of attempt 1 after it already failed
    expect(f.sent).toHaveLength(1);
    await processDelivery(f.queued[0].payload, f.deps); // the legitimate attempt 2
    expect(f.sent).toHaveLength(2);
  });

  it("auto-disables after 20 consecutive failures with no success for 5 days, notifies owners and emits the event", async () => {
    const h = harness(endpoint({ consecutiveFailures: 19 }), failRes(), { lastSuccess: "2026-10-20T00:00:00Z" });
    await processDelivery(payload(), h.deps);
    expect(h.state.disabled).toBe("auto_failures");
    expect(h.state.notified).toEqual(["o-1", "o-2"]);
    expect(h.deps.emitDisabled).toHaveBeenCalledTimes(1);
    const recent = harness(endpoint({ consecutiveFailures: 19 }), failRes(), { lastSuccess: "2026-10-31T00:00:00Z" });
    await processDelivery(payload(), recent.deps);
    expect(recent.state.disabled).toBeNull();
    expect(recent.state.failures).toBe(20);
  });

  it("does not deliver while paused, after deletion, when unsubscribed or when a filter rejects the event", async () => {
    const paused = harness(endpoint({ active: false }));
    await processDelivery(payload(), paused.deps);
    const gone = harness(null);
    await processDelivery(payload(), gone.deps);
    const other = harness(endpoint({ eventTypes: ["deal.*"] }));
    await processDelivery(payload(), other.deps);
    const filtered = harness(endpoint({ eventTypes: joinEventTypes(["lead.*"], { pii: false, filters: [{ field: "stage", values: ["lost"] }] }) }));
    await processDelivery(payload(), filtered.deps);
    for (const x of [paused, gone, other, filtered]) expect(x.sent).toHaveLength(0);
  });

  it("gives up at once (no retries) when the destination is blocked at send time", async () => {
    const blocked: SendResult = { ok: false, status: null, ms: 1, excerpt: "blocked: non-public address", kind: "blocked" };
    const h = harness(endpoint(), blocked);
    await processDelivery(payload(), h.deps);
    expect(h.queued).toHaveLength(0);
    expect(h.state.rows[0]).toMatchObject({ status: "dead", responseExcerpt: "blocked: non-public address" });
  });

  it("marks the row dead when the event has aged out or no secret exists", async () => {
    const noEvent = harness(endpoint(), okRes, { event: null });
    expect(await processDelivery(payload(), noEvent.deps)).toBe("done");
    expect(noEvent.sent).toHaveLength(0);
    const noSecret = harness(endpoint({ secretId: "missing" }));
    await processDelivery(payload(), noSecret.deps);
    expect(noSecret.sent).toHaveLength(0);
    expect(noSecret.state.rows[0]).toMatchObject({ status: "dead", responseExcerpt: "no signing secret" });
  });

  it("replay creates a new delivery row that is sent once, with the same webhook-id", async () => {
    const h = harness(endpoint());
    await processDelivery(payload(), h.deps);
    const replayRow = await h.store.insertDelivery({ endpointId: "ep-1", eventId: "100", eventType: "lead.updated", attempt: 1, status: "pending" });
    await processDelivery(payload({ delivery_id: replayRow.id, replay: true, dedupe: `wh-replay:${replayRow.id}` }), h.deps);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].headers["webhook-id"]).toBe(h.sent[0].headers["webhook-id"]);
    expect(h.state.rows[1].status).toBe("succeeded");
    await processDelivery(payload({ delivery_id: replayRow.id, replay: true }), h.deps); // redelivered replay message
    expect(h.sent).toHaveLength(2);
  });

  it("never logs secrets, bodies or PII", async () => {
    const h = harness(endpoint({ eventTypes: joinEventTypes(["lead.*"], { pii: true, filters: [] }) }), failRes(), { pii: true });
    await processDelivery(payload(), h.deps);
    const all = h.logs.join("\n");
    expect(all).not.toMatch(/whsec_|ana@example|hooks\.example\.com|"data"/);
    expect(all).not.toContain(SECRET_A);
  });
});

describe("test ping", () => {
  it("sends a signed webhook.test event, logs it once and never queues a retry", async () => {
    const h = harness(endpoint(), failRes(503));
    const r = await sendTestEvent(endpoint(), h.deps);
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(JSON.parse(h.sent[0].body)).toMatchObject({ type: "webhook.test", org_id: "t-1" });
    expect(verifySignature(SECRET_A, h.sent[0].headers, h.sent[0].body, Math.floor(NOW / 1000))).toBe(true);
    expect(h.state.rows).toHaveLength(1);
    expect(h.state.rows[0]).toMatchObject({ eventType: "webhook.test", eventId: null, status: "dead" });
    expect(h.queued).toHaveLength(0);
    expect(h.state.failures).toBe(0);
  });
});
