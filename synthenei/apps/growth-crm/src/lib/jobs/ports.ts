// Ports the drainer talks to, with the Supabase (service client) implementation. Tests use in-memory fakes.
import type { Db } from "@/lib/db/client";
import { dlqName, type QueueName } from "./queues";

/** Wire body of a message (CONTRACTS C8.2). The `events` queue's trigger-written body has no kind; the drainer normalises it. */
export interface MessageBody {
  kind?: string;
  tenant_id?: string | null;
  payload?: unknown;
  /** Failed attempts already counted before this copy was enqueued (see drain.ts re-enqueue). */
  attempt?: number;
  [k: string]: unknown;
}
export interface QueueMessage { msg_id: number; read_ct: number; enqueued_at?: string; vt?: string; message: MessageBody }

export interface QueuePort {
  read(queue: string, vtSeconds: number, qty: number): Promise<QueueMessage[]>;
  send(queue: string, body: MessageBody, delaySeconds?: number): Promise<number>;
  /** Archive (keeps a copy in pgmq's archive table). */
  archive(queue: string, msgId: number): Promise<void>;
  delete(queue: string, msgId: number): Promise<void>;
}

export interface RunStart { queue: string; msgId: number; kind: string; tenantId: string | null; workspaceId: string | null; attempt: number }
export type RunStatus = "succeeded" | "failed" | "dead";
export interface RunStore {
  start(r: RunStart): Promise<number>;
  finish(id: number, status: RunStatus, ms: number, error?: string): Promise<void>;
}

type RpcClient = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string } | null }> };
type TableClient = { from(t: string): any }; // eslint-disable-line @typescript-eslint/no-explicit-any

function fail(what: string, e: { message?: string }): never {
  // message text from PostgREST can carry row detail; keep only the first line and cap it.
  throw new Error(`${what}: ${(e.message ?? "error").split("\n")[0].slice(0, 200)}`);
}

export function supabaseQueuePort(db: Db): QueuePort {
  const c = db as unknown as RpcClient;
  return {
    async read(queue, vt, qty) {
      const { data, error } = await c.rpc("queue_read", { p_queue: queue, p_vt: vt, p_qty: qty });
      if (error) fail(`queue_read(${queue})`, error);
      return ((data as unknown[] | null) ?? []) as QueueMessage[];
    },
    async send(queue, body, delay = 0) {
      const { data, error } = await c.rpc("queue_send", { p_queue: queue, p_msg: body, p_delay: Math.max(0, Math.floor(delay)) });
      if (error) fail(`queue_send(${queue})`, error);
      return Number(data);
    },
    async archive(queue, id) {
      const { error } = await c.rpc("queue_archive", { p_queue: queue, p_msg_id: id });
      if (error) fail(`queue_archive(${queue})`, error);
    },
    async delete(queue, id) {
      const { error } = await c.rpc("queue_delete", { p_queue: queue, p_msg_id: id });
      if (error) fail(`queue_delete(${queue})`, error);
    },
  };
}

export function supabaseRunStore(db: Db): RunStore {
  const t = db as unknown as TableClient;
  return {
    async start(r) {
      const { data, error } = await t.from("job_runs")
        .insert({ queue: r.queue, msg_id: r.msgId, kind: r.kind, tenant_id: r.tenantId, workspace_id: r.workspaceId, attempt: r.attempt, status: "running" })
        .select("id").single();
      if (error) fail("job_runs insert", error);
      return Number((data as { id: number }).id);
    },
    async finish(id, status, ms, error) {
      const { error: e } = await t.from("job_runs")
        .update({ status, ms: Math.round(ms), error: error ? error.slice(0, 500) : null, finished_at: new Date().toISOString() }).eq("id", id);
      if (e) fail("job_runs update", e);
    },
  };
}

/** Move a dead-lettered message back to its source queue with a clean attempt counter (ops "requeue"). */
export async function requeueFromDlq(port: QueuePort, queue: QueueName, msgId?: number, limit = 20): Promise<number> {
  const msgs = await port.read(dlqName(queue), 30, limit);
  let n = 0;
  for (const m of msgs) {
    if (msgId !== undefined && m.msg_id !== msgId) continue;
    const { attempt: _a, dead_reason: _d, ...rest } = m.message as MessageBody & { dead_reason?: unknown };
    void _a; void _d;
    await port.send(queue, rest, 0);
    await port.delete(dlqName(queue), m.msg_id);
    n++;
  }
  return n;
}
