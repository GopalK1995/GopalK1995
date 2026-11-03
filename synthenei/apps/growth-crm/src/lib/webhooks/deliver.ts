// webhook.deliver: one HTTP attempt per message. Retries are scheduled by this handler on the CONTRACTS C10 schedule
// (the drainer's own backoff would be 5 s doubling), so a failed attempt re-enqueues a message with attempt+1 and a delay and
// then acknowledges the current one. Idempotent: redelivery of a message whose attempt already ran is acknowledged, and the
// receiver can dedupe on `webhook-id` (the event id, unchanged across retries and replays).
import { rowToEvent } from "@/lib/events/types";
import { graceActive, MAX_ATTEMPTS, retryDelaySeconds, shouldAutoDisable } from "./backoff";
import { buildEnvelope, serializeEnvelope, testEnvelope, type WebhookEnvelope } from "./payload";
import { passesFilters, splitEventTypes, subscribes } from "./options";
import { sendOnce, type SendResult } from "./send";
import { signedHeaders } from "./signing";
import type { WebhookStore } from "./store";
import type { DeliverPayload, DeliveryRow, EndpointRow } from "./types";

export interface Log { info(msg: string, f?: Record<string, unknown>): void; warn(msg: string, f?: Record<string, unknown>): void }
export interface DeliverDeps {
  store: WebhookStore;
  send?: (a: { url: string; body: string; headers: Record<string, string> }) => Promise<SendResult>;
  /** Re-enqueue this handler's message after `delaySeconds`. */
  enqueue: (payload: DeliverPayload, delaySeconds: number, tenantId: string) => Promise<void>;
  /** Best effort: raise the webhook.endpoint.disabled event. */
  emitDisabled?: (e: EndpointRow) => Promise<void>;
  now?: () => number;
  rand?: () => number;
  log?: Log;
}
const noop: Log = { info() {}, warn() {} };

/** Current secret first, then the previous one while the 24 h rotation grace window is open. */
export async function signingSecrets(store: WebhookStore, e: EndpointRow, now: number): Promise<string[]> {
  const out: string[] = [];
  if (e.secretId) { const s = await store.secret(e.secretId); if (s) out.push(s); }
  if (e.previousSecretId && graceActive(e.secretRotatedAt, now)) { const s = await store.secret(e.previousSecretId); if (s) out.push(s); }
  return out;
}

async function post(deps: DeliverDeps, e: EndpointRow, env: WebhookEnvelope, secrets: string[]): Promise<SendResult> {
  const now = deps.now ?? Date.now;
  const body = serializeEnvelope(env);
  const headers = signedHeaders(secrets, env.id, Math.floor(now() / 1000), body);
  return (deps.send ?? sendOnce)({ url: e.url, body, headers: headers as unknown as Record<string, string> });
}

const outcome = (r: SendResult) => ({ responseStatus: r.status, responseMs: r.ms, responseExcerpt: r.excerpt });

async function onFailure(deps: DeliverDeps, e: EndpointRow, now: number) {
  const n = e.consecutiveFailures + 1;
  await deps.store.setFailures(e.id, n);
  if (n >= 20 && e.active) {
    const last = await deps.store.lastSuccessAt(e.id);
    if (shouldAutoDisable(n, last, e.createdAt, now)) {
      await deps.store.disable(e.id, "auto_failures");
      await deps.store.notifyOwners(e, await deps.store.ownerIds(e.workspaceId));
      await deps.emitDisabled?.(e).catch(() => undefined);
      deps.log?.warn("webhook endpoint auto-disabled", { endpoint_id: e.id, failures: n });
    }
  }
}

export async function processDelivery(p: DeliverPayload, deps: DeliverDeps): Promise<"done" | "retry"> {
  const { store } = deps;
  const log = deps.log ?? noop;
  const now = (deps.now ?? Date.now)();
  const attempt = p.attempt ?? 1;
  const e = await store.endpoint(p.endpoint_id, p.workspace_id);
  if (!e) return "done"; // endpoint deleted

  let row: DeliveryRow | null = null;
  if (p.delivery_id) row = await store.deliveryById(p.delivery_id, e.id);
  else if (p.event_id) row = await store.latestDelivery(e.id, String(p.event_id));
  // Idempotent redelivery: this message (or a later one) already finished or already ran this attempt.
  if (row && (row.status === "succeeded" || row.status === "dead")) return "done";
  if (row && row.status === "failed" && row.attempt >= attempt) return "done";

  if (!e.active) {
    if (row) await store.updateDelivery(row.id, row.createdAt, { status: "dead", responseExcerpt: "endpoint paused", nextAttemptAt: null });
    return "done";
  }
  if (!p.event_id) return "done";
  const evRow = await store.event(String(p.event_id), p.workspace_id, p.occurred_at || undefined);
  if (!evRow) {
    if (row) await store.updateDelivery(row.id, row.createdAt, { status: "dead", responseExcerpt: "event no longer available", nextAttemptAt: null });
    log.warn("event row not found for webhook delivery");
    return "done";
  }
  const ev = rowToEvent(evRow);
  const { types, options } = splitEventTypes(e.eventTypes);
  if (!subscribes(types, ev.type) || !passesFilters(options.filters, ev)) return "done"; // edited since fan-out, or filtered out

  const includePii = options.pii && (await store.creatorHoldsPii(e));
  const env = buildEnvelope(ev, { includePii });
  const secrets = await signingSecrets(store, e, now);
  if (!row) row = await store.insertDelivery({ endpointId: e.id, eventId: String(p.event_id), eventType: ev.type, attempt, status: "pending" });
  if (secrets.length === 0) {
    await store.updateDelivery(row.id, row.createdAt, { attempt, status: "dead", responseExcerpt: "no signing secret", nextAttemptAt: null });
    return "done";
  }

  const res = await post(deps, e, env, secrets);
  if (res.ok) {
    await store.updateDelivery(row.id, row.createdAt, { attempt, status: "succeeded", nextAttemptAt: null, ...outcome(res) });
    if (e.consecutiveFailures > 0) await store.setFailures(e.id, 0);
    log.info("webhook delivered", { endpoint_id: e.id, attempt, ms: res.ms });
    return "done";
  }

  // A blocked destination will not become public by waiting: no retries.
  const delay = res.kind === "blocked" ? null : retryDelaySeconds(attempt, deps.rand);
  if (delay == null) {
    await store.updateDelivery(row.id, row.createdAt, { attempt, status: "dead", nextAttemptAt: null, ...outcome(res) });
  } else {
    await deps.enqueue({ ...p, attempt: attempt + 1, delivery_id: row.id }, delay, e.tenantId);
    await store.updateDelivery(row.id, row.createdAt, { attempt, status: "failed", nextAttemptAt: new Date(now + delay * 1000).toISOString(), ...outcome(res) });
  }
  await onFailure(deps, e, now);
  log.warn("webhook attempt failed", { endpoint_id: e.id, attempt, kind: res.kind, status: res.status, max: MAX_ATTEMPTS });
  return "done";
}

/** Test ping: one signed synthetic event, logged like any delivery, never retried, never queued. */
export async function sendTestEvent(e: EndpointRow, deps: DeliverDeps): Promise<{ ok: boolean; status: number | null; ms: number; kind: SendResult["kind"] }> {
  const now = (deps.now ?? Date.now)();
  const secrets = await signingSecrets(deps.store, e, now);
  if (secrets.length === 0) return { ok: false, status: null, ms: 0, kind: "connection" };
  const id = `evt_test_${now.toString(36)}${Math.floor((deps.rand ?? Math.random)() * 1e6).toString(36)}`;
  const env = testEnvelope({ id, tenantId: e.tenantId, workspaceId: e.workspaceId, now: new Date(now).toISOString() });
  const row = await deps.store.insertDelivery({ endpointId: e.id, eventId: null, eventType: "webhook.test", attempt: 1, status: "pending" });
  const res = await post(deps, e, env, secrets);
  await deps.store.updateDelivery(row.id, row.createdAt, { status: res.ok ? "succeeded" : "dead", nextAttemptAt: null, ...outcome(res) });
  return { ok: res.ok, status: res.status, ms: res.ms, kind: res.kind };
}

