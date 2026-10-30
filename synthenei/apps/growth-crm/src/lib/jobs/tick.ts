// One tick: materialise due schedules, then drain the queues. Used by the route and by the ops console.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Db } from "@/lib/db/client";
import { log } from "@/lib/obs/log";
import { drain, type DrainResult } from "./drain";
import "./handlers";
import { supabaseQueuePort, supabaseRunStore } from "./ports";
import type { Logger } from "./registry";
import { materialiseDue, type MaterialiseResult } from "./scheduler";

/** Adapts the JSON/PII-scrubbing logger (async) to the synchronous Logger handlers use. Never throws. */
export function jobLogger(extra: Record<string, unknown> = {}): Logger {
  const w = (level: "info" | "warn" | "error") => (msg: string, f?: Record<string, unknown>) => { void log(level, msg, { route: "jobs", ...extra, ...f }).catch(() => undefined); };
  return { info: w("info"), warn: w("warn"), error: w("error") };
}

export interface TickResult extends DrainResult { scheduled: MaterialiseResult | null }

export async function runTick(db: SupabaseClient, requestId?: string): Promise<TickResult> {
  const logger = jobLogger(requestId ? { request_id: requestId } : {});
  const port = supabaseQueuePort(db as unknown as Db);
  let scheduled: MaterialiseResult | null = null;
  try { scheduled = await materialiseDue(db, port); } catch (e) { logger.error("scheduler failed", { error: e instanceof Error ? e.message.slice(0, 200) : "error" }); }
  const r = await drain({ port, runs: supabaseRunStore(db as unknown as Db), db, log: logger });
  return { ...r, scheduled };
}
