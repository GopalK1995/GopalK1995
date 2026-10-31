// `notify` queue handler for kind "notify.event". Registered by importing this module from src/lib/jobs/handlers/index.ts.
import { KIND, type NotifyEventPayload } from "@/lib/jobs/payloads";
import { registerHandler, type JobHandler } from "@/lib/jobs/registry";
import type { Db } from "@/lib/db/client";
import { supabaseNotifyPorts } from "./ports";
import { processNotify } from "./process";

export const notifyEvent: JobHandler<NotifyEventPayload> = (payload, ctx) =>
  processNotify(payload, supabaseNotifyPorts(ctx.db as unknown as Db), { log: (m, f) => ctx.log.info(m, f) });

registerHandler("notify", KIND.notifyEvent, notifyEvent);
