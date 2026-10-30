// Handler registry (CONTRACTS C8.2). Handlers register themselves on import; handlers/index.ts imports them all.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueueName } from "./queues";
import { supabaseQueuePort } from "./ports";

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface JobContext {
  runId: number;
  /** 1-based attempt number for this delivery. */
  attempt: number;
  tenantId: string | null;
  log: Logger;
  /** Absolute ms epoch after which the handler must wrap up. */
  deadline: number;
  /** Service-role client. */
  db: SupabaseClient;
}
export type JobHandler<P> = (payload: P, ctx: JobContext) => Promise<"done" | "retry">;

const handlers = new Map<string, JobHandler<never>>();
const key = (q: QueueName, kind: string) => `${q}:${kind}`;

export function registerHandler<P>(queue: QueueName, kind: string, h: JobHandler<P>): void {
  handlers.set(key(queue, kind), h as unknown as JobHandler<never>);
}
/** Exact kind first, then the queue wildcard "*" (used by the agent queue consumer). */
export function getHandler(queue: QueueName, kind: string): JobHandler<unknown> | undefined {
  return (handlers.get(key(queue, kind)) ?? handlers.get(key(queue, "*"))) as unknown as JobHandler<unknown> | undefined;
}
export function registeredKinds(): string[] {
  return [...handlers.keys()].sort();
}
/** Test helper. */
export function clearHandlers(): void {
  handlers.clear();
}

/** Producer API. Returns the pgmq msg_id. Business writes use DB triggers instead (same-transaction outbox). */
export async function enqueue(queue: QueueName, kind: string, payload: unknown, opts: { delaySeconds?: number; tenantId?: string } = {}): Promise<number> {
  const { serviceDb } = await import("@/lib/db/service");
  return supabaseQueuePort(serviceDb()).send(queue, { kind, tenant_id: opts.tenantId ?? null, payload }, opts.delaySeconds ?? 0);
}
