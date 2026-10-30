// Queue names and drainer constants (BUILD-PLAN 1.6, CONTRACTS C8.2).
export const QUEUES = ["events", "webhook_out", "connector_sync", "connector_inbound", "notify", "import", "maintenance", "agent"] as const;
export type QueueName = (typeof QUEUES)[number];

export const dlqName = (q: QueueName): string => `${q}_dlq`;
export const isQueueName = (s: string): s is QueueName => (QUEUES as readonly string[]).includes(s);

/** A message is dead-lettered when its 8th attempt fails (or it is found already past 8 attempts). */
export const MAX_ATTEMPTS = 8;
/** pgmq visibility timeout for a read, seconds. */
export const VISIBILITY_TIMEOUT_S = 60;
export const READ_BATCH = 20;
/** Stop pulling new work 30 s before the deadline; deadline = start + 240 s (maxDuration is 300 s). */
export const TICK_BUDGET_MS = 240_000;
export const PULL_STOP_MARGIN_MS = 30_000;
/** Max handler runs in flight for one tenant, and max handled per queue pass; the rest are deferred briefly. */
export const TENANT_IN_FLIGHT = 2;
export const TENANT_PER_PASS = 10;
export const GLOBAL_CONCURRENCY = 8;

/** Exponential backoff with a cap: 5 s, 10 s, 20 s ... 15 min. */
export function backoffSeconds(attempt: number): number {
  return Math.min(900, 5 * 2 ** Math.max(0, attempt - 1));
}
