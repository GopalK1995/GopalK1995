// Job handlers on the connector_sync queue (CONTRACTS C8.2) and the event fan-out for connector pushes.
//   connector.scan     (scheduled_jobs row, every 15 min): finds due streams and expiring tokens, enqueues the rest
//   connector.sync     {connection_id, stream?, trigger, dedupe}
//   connector.push     {connection_id, push, lead_ids, dedupe}
//   connector.refresh  {connection_id}
// Import this module from src/lib/jobs/handlers/index.ts (integrator) so the handlers and the fan-out extension register.
import type { SupabaseClient } from "@supabase/supabase-js";
import { eventMatches, registerFanout, type Outbound } from "@/lib/jobs/fanout";
import { registerHandler, type JobHandler } from "@/lib/jobs/registry";
import { nextCronRun } from "@/lib/jobs/cron";
import { enqueue } from "@/lib/jobs/registry";
import { getConnector } from "../registry";
import { refreshIfNeeded } from "./lifecycle";
import type { RuntimeDeps } from "./ports";
import { runtimeFromDb } from "./runtime";
import { isRunnable, runPush, runSync, type RunTrigger } from "./sync";
import type { Db } from "@/lib/db/client";
import { TransientError } from "./types";

export const CONNECTOR_KIND = { scan: "connector.scan", sync: "connector.sync", push: "connector.push", refresh: "connector.refresh" } as const;

export interface SyncJobPayload { connection_id: string; stream?: string; trigger?: RunTrigger; dedupe?: string; started_by?: string | null }
export interface PushJobPayload { connection_id: string; push: string; lead_ids: string[]; dedupe?: string }
export interface RefreshJobPayload { connection_id: string }

type Make = (db: SupabaseClient, log: RuntimeDeps["log"]) => RuntimeDeps;
let makeDeps: Make | null = null;
/** Tests inject fake deps; production builds the service-role runtime from the job's client. */
export function setRuntimeFactory(f: Make | null): void { makeDeps = f; }
const depsFor = (ctxDb: SupabaseClient, log: RuntimeDeps["log"]): RuntimeDeps => (makeDeps ? makeDeps(ctxDb, log) : runtimeFromDb(ctxDb as unknown as Db, log));

export const syncHandler: JobHandler<SyncJobPayload> = async (p, ctx) => {
  const out = await runSync(depsFor(ctx.db, ctx.log), { connectionId: p.connection_id, stream: p.stream, trigger: p.trigger ?? "poll", startedBy: p.started_by, deadlineMs: ctx.deadline - 20_000 });
  return out.retry ? "retry" : "done";
};
export const pushHandler: JobHandler<PushJobPayload> = async (p, ctx) => {
  const out = await runPush(depsFor(ctx.db, ctx.log), { connectionId: p.connection_id, pushKey: p.push, leadIds: p.lead_ids });
  return out.retry ? "retry" : "done";
};
export const refreshHandler: JobHandler<RefreshJobPayload> = async (p, ctx) => {
  const d = depsFor(ctx.db, ctx.log);
  const conn = await d.store.getConnection(p.connection_id);
  if (!conn || !isRunnable(conn)) return "done";
  try { await refreshIfNeeded(d, conn, 15 * 60); } catch (e) { if (e instanceof TransientError) return "retry"; throw e; }
  return "done";
};

/** Due = the stream's next cron slot after the last sync is already in the past. The slot is the dedupe key, so a slow tick never double-runs it. */
export const scanHandler: JobHandler<Record<string, unknown>> = async (_p, ctx) => {
  const d = depsFor(ctx.db, ctx.log);
  const now = Date.now();
  let queued = 0;
  for (const conn of await d.store.listActiveConnections()) {
    const def = getConnector(conn.connectorId);
    if (!def) continue;
    if (def.auth === "oauth2" && conn.tokenExpiresAt && Date.parse(conn.tokenExpiresAt) - now < 30 * 60_000) {
      await enqueue("connector_sync", CONNECTOR_KIND.refresh, { connection_id: conn.id } satisfies RefreshJobPayload, { tenantId: conn.tenantId }); queued++;
    }
    const last = conn.lastSyncAt ? Date.parse(conn.lastSyncAt) : 0;
    for (const s of def.streams) {
      if (!s.schedule) continue;
      const slot = nextCronRun(s.schedule.cron, s.schedule.tz, last || now - 24 * 3600_000);
      if (slot === null || slot > now) continue;
      await enqueue("connector_sync", CONNECTOR_KIND.sync, { connection_id: conn.id, stream: s.key, trigger: "poll", dedupe: `sync:${conn.id}:${s.key}:${slot}` } satisfies SyncJobPayload, { tenantId: conn.tenantId }); queued++;
    }
  }
  ctx.log.info("connector scan", { queued });
  return "done";
};

registerHandler("connector_sync", CONNECTOR_KIND.scan, scanHandler);
registerHandler("connector_sync", CONNECTOR_KIND.sync, syncHandler);
registerHandler("connector_sync", CONNECTOR_KIND.push, pushHandler);
registerHandler("connector_sync", CONNECTOR_KIND.refresh, refreshHandler);

/** Events -> pushes. Only lead-scoped events can name a consenting contact, so other objects produce no push (fail closed). */
export async function routeConnectorPushes(ev: { id: string; type: string; tenantId: string; workspaceId: string; objectType: string | null; objectId: string | null }, db: SupabaseClient): Promise<Outbound[]> {
  if (ev.objectType !== "lead" || !ev.objectId) return [];
  const d = depsFor(db, { info() {}, warn() {}, error() {} });
  const out: Outbound[] = [];
  for (const conn of await d.store.listActiveConnections()) {
    if (conn.workspaceId !== ev.workspaceId || !isRunnable(conn)) continue;
    const def = getConnector(conn.connectorId);
    for (const push of def?.pushes ?? []) {
      if (!(push.onEvent ?? []).some((pat) => eventMatches(pat, ev.type))) continue;
      const payload: PushJobPayload = { connection_id: conn.id, push: push.key, lead_ids: [ev.objectId], dedupe: `cp:${ev.id}:${conn.id}:${push.key}` };
      out.push({ queue: "connector_sync", body: { kind: CONNECTOR_KIND.push, tenant_id: ev.tenantId, payload } });
    }
  }
  return out;
}
registerFanout((ev, db) => routeConnectorPushes(ev, db));
