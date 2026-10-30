// The queue drainer (BUILD-PLAN 1.6). Pure of Next/Supabase: talks to QueuePort and RunStore, so unit tests use fakes.
import type { SupabaseClient } from "@supabase/supabase-js";
import { scrubString } from "@/lib/obs/scrub";
import type { QueueMessage, QueuePort, RunStore } from "./ports";
import {
  GLOBAL_CONCURRENCY, MAX_ATTEMPTS, PULL_STOP_MARGIN_MS, QUEUES, READ_BATCH, TENANT_IN_FLIGHT, TENANT_PER_PASS,
  TICK_BUDGET_MS, VISIBILITY_TIMEOUT_S, backoffSeconds, dlqName, type QueueName,
} from "./queues";
import { getHandler, type JobContext, type Logger } from "./registry";

export interface DrainOptions {
  port: QueuePort;
  runs: RunStore;
  db: SupabaseClient;
  log: Logger;
  queues?: readonly QueueName[];
  now?: () => number;
  budgetMs?: number;
  stopMarginMs?: number;
  maxAttempts?: number;
  tenantInFlight?: number;
  tenantPerPass?: number;
  globalConcurrency?: number;
  readBatch?: number;
  maxRounds?: number;
}
export interface DrainResult {
  processed: number; failed: number; dead: number; deferred: number; ms: number;
  stoppedBy: "empty" | "budget" | "rounds";
}

/** Run fn over items with at most n in flight. */
async function pool<T>(items: readonly T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const errText = (e: unknown): string => scrubString(e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error("handler exceeded the tick time budget")), Math.max(1, ms)); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

export async function drain(o: DrainOptions): Promise<DrainResult> {
  const now = o.now ?? Date.now;
  const start = now();
  const deadline = start + (o.budgetMs ?? TICK_BUDGET_MS);
  const pullUntil = deadline - (o.stopMarginMs ?? PULL_STOP_MARGIN_MS);
  const hardDeadline = deadline + 15_000;
  const maxAttempts = o.maxAttempts ?? MAX_ATTEMPTS;
  const tenantInFlight = o.tenantInFlight ?? TENANT_IN_FLIGHT;
  const tenantPerPass = o.tenantPerPass ?? TENANT_PER_PASS;
  const res: DrainResult = { processed: 0, failed: 0, dead: 0, deferred: 0, ms: 0, stoppedBy: "empty" };

  async function handleOne(queue: QueueName, m: QueueMessage): Promise<void> {
    const body = m.message ?? {};
    const kind = body.kind ?? (queue === "events" ? "event.fanout" : "unknown");
    // The events trigger writes a bare body without kind/payload; use the whole body as the payload then.
    const payload = body.kind ? body.payload : body;
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : null;
    const wsRaw = (payload as { workspace_id?: unknown } | null | undefined)?.workspace_id;
    const workspaceId = typeof wsRaw === "string" ? wsRaw : null;
    const attempt = (body.attempt ?? 0) + Math.max(1, m.read_ct);
    const t0 = now();
    const base = { queue, kind, msg: m.msg_id, attempt };

    const moveToDlq = async (reason: string) => {
      await o.port.send(dlqName(queue), { ...body, attempt, dead_reason: reason }, 0);
      await o.port.delete(queue, m.msg_id);
    };
    const runId = await o.runs.start({ queue, msgId: m.msg_id, kind, tenantId, workspaceId, attempt });

    // A message already past its budget of attempts (e.g. the function was killed mid-run every time) is never run again.
    if (attempt > maxAttempts) {
      await moveToDlq("attempts exhausted");
      await o.runs.finish(runId, "dead", now() - t0, "attempts exhausted");
      o.log.error("job dead-lettered", base);
      res.dead++;
      return;
    }

    let error: string | null = null;
    const handler = getHandler(queue, kind);
    if (!handler) error = `no handler registered for ${queue}:${kind}`;
    else {
      const ctx: JobContext = {
        runId, attempt, tenantId, deadline, db: o.db,
        log: { info: (s, f) => o.log.info(s, { ...base, ...f }), warn: (s, f) => o.log.warn(s, { ...base, ...f }), error: (s, f) => o.log.error(s, { ...base, ...f }) },
      };
      try {
        const out = await withTimeout(handler(payload, ctx), hardDeadline - now());
        if (out !== "done") error = "handler asked for retry";
      } catch (e) {
        error = errText(e);
      }
    }

    if (!error) {
      await o.port.archive(queue, m.msg_id);
      await o.runs.finish(runId, "succeeded", now() - t0);
      res.processed++;
      return;
    }
    if (attempt >= maxAttempts) {
      await moveToDlq(error);
      await o.runs.finish(runId, "dead", now() - t0, error);
      o.log.error("job dead-lettered", { ...base, error });
      res.dead++;
      return;
    }
    // Retry with backoff: enqueue the next copy first, then delete this one. A crash between the two duplicates, never loses,
    // which is why every handler must be idempotent.
    const delay = backoffSeconds(attempt);
    await o.port.send(queue, { ...body, attempt }, delay);
    await o.port.delete(queue, m.msg_id);
    await o.runs.finish(runId, "failed", now() - t0, error);
    o.log.warn("job failed, will retry", { ...base, error, retry_in_s: delay });
    res.failed++;
  }

  async function defer(queue: QueueName, m: QueueMessage): Promise<void> {
    // Not a failure: same attempt count, short delay.
    await o.port.send(queue, { ...m.message, attempt: (m.message.attempt ?? 0) + Math.max(1, m.read_ct) - 1 }, 3);
    await o.port.delete(queue, m.msg_id);
    res.deferred++;
  }

  async function runBatch(queue: QueueName, msgs: QueueMessage[]): Promise<void> {
    const lanes = new Map<string, QueueMessage[]>();
    for (const m of msgs) {
      const k = typeof m.message?.tenant_id === "string" ? m.message.tenant_id : "_platform";
      const lane = lanes.get(k) ?? [];
      lane.push(m);
      lanes.set(k, lane);
    }
    const safe = async (fn: () => Promise<void>, m: QueueMessage) => {
      try { await fn(); } catch (e) {
        // Store/port failure: leave the message to reappear after its visibility timeout.
        o.log.error("job bookkeeping failed", { queue, msg: m.msg_id, error: errText(e) });
        res.failed++;
      }
    };
    await pool([...lanes.values()], Math.max(1, Math.ceil((o.globalConcurrency ?? GLOBAL_CONCURRENCY) / tenantInFlight)), async (lane) => {
      const first = lane.slice(0, tenantPerPass);
      const rest = lane.slice(tenantPerPass);
      await pool(first, tenantInFlight, (m) => safe(() => handleOne(queue, m), m));
      for (const m of rest) await safe(() => defer(queue, m), m);
    });
  }

  const queues = o.queues ?? QUEUES;
  const batch = o.readBatch ?? READ_BATCH;
  const maxRounds = o.maxRounds ?? 200;
  for (let round = 0; ; round++) {
    if (round >= maxRounds) { res.stoppedBy = "rounds"; break; }
    if (now() >= pullUntil) { res.stoppedBy = "budget"; break; }
    let pulled = 0;
    for (const q of queues) {
      if (now() >= pullUntil) break;
      const msgs = await o.port.read(q, VISIBILITY_TIMEOUT_S, batch);
      if (msgs.length === 0) continue;
      pulled += msgs.length;
      await runBatch(q, msgs);
    }
    if (pulled === 0) { res.stoppedBy = "empty"; break; }
  }
  res.ms = now() - start;
  return res;
}
