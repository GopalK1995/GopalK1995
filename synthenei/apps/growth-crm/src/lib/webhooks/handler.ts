// Registers the webhook_out consumer and the housekeeping job. Imported once from src/lib/jobs/handlers/index.ts.
import type { Db } from "@/lib/db/client";
import { emitEvent } from "@/lib/events/emit";
import { KIND } from "@/lib/jobs/payloads";
import { supabaseQueuePort } from "@/lib/jobs/ports";
import { registerHandler, type JobHandler } from "@/lib/jobs/registry";
import { DELIVERY_RETENTION_DAYS, ROTATION_GRACE_MS } from "./backoff";
import { processDelivery } from "./deliver";
import { supabaseWebhookStore } from "./store";
import type { DeliverPayload } from "./types";

export const deliverWebhook: JobHandler<DeliverPayload> = async (p, ctx) => {
  const store = supabaseWebhookStore(ctx.db);
  const port = supabaseQueuePort(ctx.db as unknown as Db);
  return processDelivery(p, {
    store, log: ctx.log,
    enqueue: async (payload, delaySeconds, tenantId) => {
      await port.send("webhook_out", { kind: KIND.webhookDeliver, tenant_id: tenantId, payload }, delaySeconds);
    },
    emitDisabled: async (e) => {
      await emitEvent({ type: "webhook.endpoint.disabled", objectType: "webhook_endpoint", objectId: e.id, workspaceId: e.workspaceId, data: { endpoint_id: e.id, reason: "auto_failures" } }, ctx.db as unknown as Db);
    },
  });
};

export const WEBHOOK_HOUSEKEEPING = "webhook.housekeeping";

/** Deletes delivery rows past retention and retires previous secrets once the rotation grace window closed. Idempotent. */
export const housekeeping: JobHandler<Record<string, never>> = async (_p, ctx) => {
  const db = ctx.db;
  const cutoff = new Date(Date.now() - DELIVERY_RETENTION_DAYS * 24 * 3600 * 1000).toISOString();
  const del = await db.from("webhook_deliveries").delete().lt("created_at", cutoff);
  if (del.error) throw new Error(`webhook_deliveries retention: ${del.error.message}`);
  const stale = await db.from("webhook_endpoints").select("id,previous_secret_id").not("previous_secret_id", "is", null).lt("secret_rotated_at", new Date(Date.now() - ROTATION_GRACE_MS).toISOString());
  if (stale.error) throw new Error(`webhook_endpoints: ${stale.error.message}`);
  for (const r of (stale.data as { id: string; previous_secret_id: string }[] | null) ?? []) {
    await db.rpc("vault_delete_secret", { p_id: r.previous_secret_id });
    await db.from("webhook_endpoints").update({ previous_secret_id: null }).eq("id", r.id);
  }
  return "done";
};

registerHandler("webhook_out", KIND.webhookDeliver, deliverWebhook);
registerHandler("maintenance", WEBHOOK_HOUSEKEEPING, housekeeping);
