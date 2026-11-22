// Job handlers on the maintenance queue (kind prefix "backup." routes there in scheduler.ts). Registered by importing this
// module from src/lib/jobs/handlers/index.ts. Scheduling rows (scheduled_jobs) are in docs/migrations-backlog.md, T055 needs.
import "server-only";
import type { Db } from "@/lib/db/client";
import { registerHandler, type JobHandler } from "@/lib/jobs/registry";
import { evaluateAll } from "./evaluate";
import { runHeartbeat } from "./heartbeat";
import { supabaseBackupStore } from "./store";

export const BACKUP_KIND = { heartbeat: "backup.heartbeat", evaluate: "backup.evaluate" } as const;

export const backupHeartbeat: JobHandler<Record<string, unknown>> = async (_p, ctx) => {
  const r = await runHeartbeat(supabaseBackupStore(ctx.db as unknown as Db));
  ctx.log.info("backup heartbeat", { ...r });
  // Every workspace failing is a real problem: let the queue retry (and dead-letter) instead of archiving a failed night.
  return r.workspaces > 0 && r.written === 0 ? "retry" : "done";
};

export const backupEvaluate: JobHandler<Record<string, unknown>> = async (_p, ctx) => {
  const r = await evaluateAll(supabaseBackupStore(ctx.db as unknown as Db));
  ctx.log.info("backup alert rules evaluated", { ...r });
  return "done";
};

registerHandler("maintenance", BACKUP_KIND.heartbeat, backupHeartbeat);
registerHandler("maintenance", BACKUP_KIND.evaluate, backupEvaluate);
