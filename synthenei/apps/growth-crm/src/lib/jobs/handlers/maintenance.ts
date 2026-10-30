// maintenance queue: the scheduler tick can also be enqueued explicitly (for example by pg_cron maintenance).
import type { Db } from "@/lib/db/client";
import { KIND, type SchedulerTickPayload } from "../payloads";
import { supabaseQueuePort } from "../ports";
import { registerHandler, type JobHandler } from "../registry";
import { materialiseDue } from "../scheduler";

export const schedulerTick: JobHandler<SchedulerTickPayload> = async (p, ctx) => {
  const r = await materialiseDue(ctx.db, supabaseQueuePort(ctx.db as unknown as Db), Date.now(), p?.limit ?? 50);
  ctx.log.info("scheduled jobs materialised", { ...r });
  return "done";
};

registerHandler("maintenance", KIND.schedulerTick, schedulerTick);
