// Health aggregation, pure so it can be unit tested. The queue part is tolerant until migration 0014 is applied.
export type Check = { status: "ok" | "skipped" | "error"; detail?: string; ms?: number };
export type QueueCheck = Check & { oldest_message_age_s?: Record<string, number>; failed_jobs_1h?: number | null };
export type HealthReport = { status: "ok" | "degraded" | "down"; time: string; db: Check; queues: QueueCheck };

export function summarize(db: Check, queues: QueueCheck, time = new Date().toISOString()): HealthReport {
  const status = db.status === "error" ? "down" : queues.status === "error" ? "degraded" : "ok";
  return { status, time, db, queues };
}
