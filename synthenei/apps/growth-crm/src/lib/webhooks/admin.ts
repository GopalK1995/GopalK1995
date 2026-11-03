// Endpoint lifecycle for the settings screen: create, edit, pause/resume, delete, rotate secret, replay, test ping.
// Server-only. The caller (server action) has already run assertCan and validated input. Row writes use the caller's client
// (RLS: webhooks.manage, allow_webhooks policy); Vault and the delivery path use the service client. The signing secret is
// returned from create/rotate once and is never selectable afterwards (only secret ids are stored).
import "server-only";
import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db/client";
import { DbError, throwIfError } from "@/lib/db/errors";
import { from } from "@/lib/db/query";
import { KIND } from "@/lib/jobs/payloads";
import { supabaseQueuePort } from "@/lib/jobs/ports";
import { graceActive, ROTATION_GRACE_MS } from "./backoff";
import { sendTestEvent } from "./deliver";
import { joinEventTypes, splitEventTypes, type EndpointOptions } from "./options";
import { MAX_ENDPOINTS } from "./schemas";
import { generateSecret } from "./signing";
import { supabaseWebhookStore, type WebhookStore } from "./store";
import { DELIVERY_COLS, ENDPOINT_COLS, toDelivery, toEndpoint, type DeliveryRow, type DeliverPayload, type EndpointRow } from "./types";

type Rpc = { rpc(fn: string, a: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };
type Del = { from(t: string): { delete(): { eq(c: string, v: string): { eq(c: string, v: string): PromiseLike<{ error: { code?: string; message?: string } | null }> } } } };
const rpc = (db: Db) => db as unknown as Rpc;

/** What the browser may see: never a secret id or secret. */
export interface EndpointView {
  id: string; url: string; description: string | null; eventTypes: string[]; includePii: boolean; filters: { field: string; values: string[] }[];
  active: boolean; disabledReason: string | null; consecutiveFailures: number; createdAt: string;
  rotatedAt: string | null; graceUntil: string | null;
}
export const toView = (e: EndpointRow, now = Date.now()): EndpointView => {
  const { types, options } = splitEventTypes(e.eventTypes);
  const grace = e.previousSecretId && graceActive(e.secretRotatedAt, now);
  return {
    id: e.id, url: e.url, description: e.description, eventTypes: types, includePii: options.pii, filters: options.filters, active: e.active,
    disabledReason: e.disabledReason, consecutiveFailures: e.consecutiveFailures, createdAt: e.createdAt, rotatedAt: e.secretRotatedAt,
    graceUntil: grace && e.secretRotatedAt ? new Date(Date.parse(e.secretRotatedAt) + ROTATION_GRACE_MS).toISOString() : null,
  };
};
export interface DeliveryView { id: number; createdAt: string; eventType: string; eventId: string | null; attempt: number; status: string; responseStatus: number | null; responseMs: number | null; excerpt: string | null; nextAttemptAt: string | null }
export const toDeliveryView = (d: DeliveryRow): DeliveryView => ({
  id: d.id, createdAt: d.createdAt, eventType: d.eventType, eventId: d.eventId, attempt: d.attempt, status: d.status,
  responseStatus: d.responseStatus, responseMs: d.responseMs, excerpt: d.responseExcerpt, nextAttemptAt: d.nextAttemptAt,
});

export async function listEndpoints(req: Db, ws: string): Promise<EndpointRow[]> {
  const r = await from(req, "webhook_endpoints").select(ENDPOINT_COLS).eq("workspace_id", ws).order("created_at", { ascending: false }).limit(100);
  throwIfError(r.error);
  return ((r.data as Record<string, unknown>[] | null) ?? []).map(toEndpoint);
}

export async function getEndpoint(req: Db, ws: string, id: string): Promise<EndpointRow | null> {
  const r = await from(req, "webhook_endpoints").select(ENDPOINT_COLS).eq("workspace_id", ws).eq("id", id).maybeSingle();
  throwIfError(r.error);
  return r.data ? toEndpoint(r.data as Record<string, unknown>) : null;
}

export async function listDeliveries(req: Db, endpointId: string, opts: { status?: string; limit?: number } = {}): Promise<DeliveryRow[]> {
  let q = from(req, "webhook_deliveries").select(DELIVERY_COLS).eq("endpoint_id", endpointId);
  if (opts.status) q = q.eq("status", opts.status);
  const r = await q.order("created_at", { ascending: false }).limit(Math.min(opts.limit ?? 50, 200));
  throwIfError(r.error);
  return ((r.data as Record<string, unknown>[] | null) ?? []).map(toDelivery);
}

async function putSecret(svc: Db, secret: string): Promise<string> {
  const r = await rpc(svc).rpc("vault_put_secret", { p_name: `webhook:${randomUUID()}`, p_secret: secret, p_desc: "Outbound webhook signing secret" });
  if (r.error || typeof r.data !== "string") throw new DbError("error", "error", { detail: "vault" });
  return r.data;
}
const dropSecret = async (svc: Db, id: string | null) => { if (id) await rpc(svc).rpc("vault_delete_secret", { p_id: id }).then(undefined, () => undefined); };

export interface NewEndpoint { tenantId: string; workspaceId: string; createdBy: string; url: string; description: string | null; eventTypes: string[]; options: EndpointOptions }

export async function createEndpoint(req: Db, svc: Db, i: NewEndpoint): Promise<{ endpoint: EndpointRow; secret: string }> {
  const existing = await listEndpoints(req, i.workspaceId);
  if (existing.length >= MAX_ENDPOINTS) throw new DbError("invalid", "invalid", { detail: "endpoint limit reached" });
  const secret = generateSecret();
  const sid = await putSecret(svc, secret);
  const ins = await from(req, "webhook_endpoints").insert({
    tenant_id: i.tenantId, workspace_id: i.workspaceId, url: i.url, description: i.description, event_types: joinEventTypes(i.eventTypes, i.options),
    secret_id: sid, created_by: i.createdBy,
  }).select(ENDPOINT_COLS).single();
  if (ins.error) { await dropSecret(svc, sid); throwIfError(ins.error); }
  return { endpoint: toEndpoint(ins.data as Record<string, unknown>), secret };
}

export interface EndpointChanges { url?: string; description?: string | null; eventTypes?: string[]; options?: EndpointOptions; active?: boolean }

/** Resuming clears the failure counter and the disabled reason. */
export async function updateEndpoint(req: Db, ws: string, id: string, c: EndpointChanges, current: EndpointRow): Promise<EndpointRow> {
  const row: Record<string, unknown> = {};
  if (c.url !== undefined) row.url = c.url;
  if (c.description !== undefined) row.description = c.description;
  if (c.eventTypes !== undefined || c.options !== undefined) {
    const cur = splitEventTypes(current.eventTypes);
    row.event_types = joinEventTypes(c.eventTypes ?? cur.types, c.options ?? cur.options);
  }
  if (c.active !== undefined) {
    row.active = c.active;
    row.disabled_reason = c.active ? null : "paused";
    if (c.active) row.consecutive_failures = 0;
  }
  const r = await from(req, "webhook_endpoints").update(row).eq("workspace_id", ws).eq("id", id).select(ENDPOINT_COLS).maybeSingle();
  throwIfError(r.error);
  if (!r.data) throw new DbError("not_found", "not_found");
  return toEndpoint(r.data as Record<string, unknown>);
}

export async function deleteEndpoint(req: Db, svc: Db, ws: string, e: EndpointRow): Promise<void> {
  const del = await (req as unknown as Del).from("webhook_endpoints").delete().eq("workspace_id", ws).eq("id", e.id);
  throwIfError(del.error);
  await dropSecret(svc, e.secretId);
  await dropSecret(svc, e.previousSecretId);
}

/** New secret signs from now on; the old one keeps signing for 24 h so receivers can switch without dropping events. */
export async function rotateSecret(req: Db, svc: Db, ws: string, e: EndpointRow): Promise<{ secret: string; graceUntil: string }> {
  const secret = generateSecret();
  const sid = await putSecret(svc, secret);
  const now = new Date();
  const r = await from(req, "webhook_endpoints").update({ secret_id: sid, previous_secret_id: e.secretId, secret_rotated_at: now.toISOString() }).eq("workspace_id", ws).eq("id", e.id).select("id").maybeSingle();
  if (r.error || !r.data) { await dropSecret(svc, sid); throwIfError(r.error); throw new DbError("not_found", "not_found"); }
  await dropSecret(svc, e.previousSecretId); // a rotation inside an open grace window retires the older secret at once
  return { secret, graceUntil: new Date(now.getTime() + ROTATION_GRACE_MS).toISOString() };
}

export type ReplayResult = { ok: true; deliveryId: number } | { ok: false; reason: "not_found" | "event_gone" | "paused" | "test_event" };

/** Owner-only (checked by the action). Creates a fresh delivery row and queues it; same event id, so receivers can dedupe. */
export async function replayDelivery(req: Db, svc: Db, e: EndpointRow, deliveryId: number, store: WebhookStore = supabaseWebhookStore(svc as never)): Promise<ReplayResult> {
  const d = (await listDeliveries(req, e.id, { limit: 200 })).find((x) => x.id === deliveryId);
  if (!d) return { ok: false, reason: "not_found" };
  if (!d.eventId) return { ok: false, reason: "test_event" };
  if (!e.active) return { ok: false, reason: "paused" };
  const ev = await store.event(d.eventId, e.workspaceId);
  if (!ev) return { ok: false, reason: "event_gone" };
  const row = await store.insertDelivery({ endpointId: e.id, eventId: d.eventId, eventType: d.eventType, attempt: 1, status: "pending" });
  const payload: DeliverPayload = { event_id: d.eventId, occurred_at: ev.occurred_at, endpoint_id: e.id, workspace_id: e.workspaceId, type: d.eventType, dedupe: `wh-replay:${row.id}`, delivery_id: row.id, replay: true };
  await supabaseQueuePort(svc).send("webhook_out", { kind: KIND.webhookDeliver, tenant_id: e.tenantId, payload }, 0);
  return { ok: true, deliveryId: row.id };
}

export async function pingEndpoint(svc: Db, e: EndpointRow) {
  const store = supabaseWebhookStore(svc as never);
  return sendTestEvent(e, { store, enqueue: async () => undefined });
}
