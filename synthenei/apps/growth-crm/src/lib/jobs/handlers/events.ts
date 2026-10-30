// events queue: fan one outbox event out to webhooks, notification rules, connectors and (MVP2) agents.
import { rowToEvent, type EventRow } from "@/lib/events/types";
import { routeEvent } from "../fanout";
import { KIND, type EventFanoutPayload } from "../payloads";
import { supabaseQueuePort } from "../ports";
import { registerHandler, type JobHandler } from "../registry";
import type { Db } from "@/lib/db/client";

/**
 * Idempotent in effect: redelivery re-sends messages carrying the same dedupe keys, and the delivering handlers
 * (webhook, notify, agent) dedupe on them. A missing event row is a no-op (retention may have removed it).
 */
export const fanoutEvent: JobHandler<EventFanoutPayload> = async (p, ctx) => {
  const { data, error } = await ctx.db.from("events").select("*").eq("id", p.event_id).eq("occurred_at", p.occurred_at).maybeSingle();
  if (error) throw new Error(`events read: ${error.message}`);
  if (!data) { ctx.log.warn("event row not found, acknowledging"); return "done"; }
  const msgs = await routeEvent(rowToEvent(data as EventRow), ctx.db);
  const port = supabaseQueuePort(ctx.db as unknown as Db);
  for (const m of msgs) await port.send(m.queue, m.body, 0);
  ctx.log.info("event fanned out", { event_type: p.type, messages: msgs.length });
  return "done";
};

registerHandler("events", KIND.eventFanout, fanoutEvent);
