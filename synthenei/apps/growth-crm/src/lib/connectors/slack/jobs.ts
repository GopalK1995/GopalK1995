// Slack alert routing and delivery.
//   fan-out extension: an event whose type maps to an alert (alerts.ts) produces one `slack.alert` message per active Slack connection of the
//     event's workspace (queue connector_sync). Events outside the four alert types cost nothing.
//   handler `slack.alert`: deliver.ts posts it. A transient Slack failure retries on the queue's backoff; a revoked token parks the connection.
// Import this module from src/lib/jobs/handlers/index.ts (integrator, one line) so the handler and the fan-out extension register.
import type { SupabaseClient } from "@supabase/supabase-js";
import { registerFanout, type Outbound } from "@/lib/jobs/fanout";
import { registerHandler, type JobHandler } from "@/lib/jobs/registry";
import { isRunnable } from "../core/sync";
import { supabaseStore } from "../core/store-supabase";
import { env } from "@/lib/env";
import type { Db } from "@/lib/db/client";
import { alertForEvent } from "./alerts";
import { ALERT_JOB_KIND, SLACK_CONNECTOR_ID } from "./constants";
import { deliverAlert, type AlertJob } from "./deliver";
import { slackDepsFromDb } from "./runtime";
import type { SlackDeps } from "./store";

type Make = (db: SupabaseClient) => SlackDeps;
let makeDeps: Make | null = null;
/** Tests inject fake deps. */
export function setSlackJobDeps(f: Make | null): void { makeDeps = f; }
const depsFor = (db: SupabaseClient): SlackDeps => (makeDeps ? makeDeps(db) : slackDepsFromDb(db as unknown as Db));

const str = (v: unknown, max = 80): string | undefined => (typeof v === "string" && v ? v.slice(0, max) : undefined);

export const alertHandler: JobHandler<AlertJob> = async (p, ctx) => deliverAlert(depsFor(ctx.db), p);
registerHandler("connector_sync", ALERT_JOB_KIND, alertHandler);

type Ev = { id: string; type: string; tenantId: string; workspaceId: string; objectType: string | null; objectId: string | null; data?: Record<string, unknown> };
/** Events -> alert jobs. Connection lookup is by workspace; the job re-checks the workspace again before sending. */
export async function routeSlackAlerts(ev: Ev, db: SupabaseClient): Promise<Outbound[]> {
  if (!alertForEvent(ev.type)) return [];
  const core = makeDeps ? makeDeps(db).core : supabaseStore(db as unknown as Db, env.appEnv);
  const out: Outbound[] = [];
  for (const conn of await core.listActiveConnections()) {
    if (conn.connectorId !== SLACK_CONNECTOR_ID || conn.workspaceId !== ev.workspaceId || !isRunnable(conn)) continue;
    const payload: AlertJob & { dedupe: string } = {
      connection_id: conn.id, workspace_id: ev.workspaceId, type: ev.type, event_id: ev.id, object_type: ev.objectType, object_id: ev.objectId,
      data: { connector: str(ev.data?.connector), stream: str(ev.data?.stream), reason: str(ev.data?.reason) }, dedupe: `sl:${ev.id}:${conn.id}`,
    };
    out.push({ queue: "connector_sync", body: { kind: ALERT_JOB_KIND, tenant_id: ev.tenantId, payload } });
  }
  return out;
}
registerFanout((ev, db) => routeSlackAlerts(ev, db));
