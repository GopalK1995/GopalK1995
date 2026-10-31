// Consumer for the connector_inbound queue (CONTRACTS C8/C10). The receiver already verified the signature at the edge; here the
// connector's own parser (ConnectorDef.webhook.verify = parse the stored raw body into events) and handler (webhook.handle) run.
// Idempotent: a row already processed/ignored is skipped, a failed one is retried by the queue (max attempts) and stays visible as
// status 'failed' with a scrubbed error; replayInbound() puts it back to 'queued'.
// The integrator imports this module from src/lib/jobs/handlers/index.ts so the "*" handler on connector_inbound registers.
import { getConnector } from "../registry";
import { makeUpserter } from "../core/upserter";
import { httpFor } from "../core/lifecycle";
import { safeError } from "../core/pii";
import { loadSecrets } from "../core/secrets";
import { apiBaseFor } from "../registry";
import type { RuntimeDeps } from "../core/ports";
import type { ConnectionRow, ConnectionSecrets, SyncContext } from "../core/types";
import { MAX_ATTEMPTS } from "@/lib/jobs/queues";
import { registerHandler, type JobHandler } from "@/lib/jobs/registry";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface InboxRow { id: number; connectorId: string; integrationId: string | null; signatureOk: boolean; status: "queued" | "processed" | "failed" | "ignored"; headers: Record<string, string>; body: string | null }
export interface ProcessStore {
  getInbox(id: number): Promise<InboxRow | null>;
  mark(id: number, status: "queued" | "processed" | "failed" | "ignored", error: string | null): Promise<void>;
}
export interface InboundPayload { inbox_id: number }

export type ProcessOutcome = "processed" | "ignored" | "skipped" | "failed";
export const IGNORABLE = new Set(["disconnected", "not_configured", "showcase"]);

export async function processInbound(d: RuntimeDeps, inbox: ProcessStore, id: number): Promise<ProcessOutcome> {
  const row = await inbox.getInbox(id);
  if (!row || row.status === "processed" || row.status === "ignored") return "skipped";
  if (!row.signatureOk || row.body === null || !row.integrationId) { await inbox.mark(id, "ignored", "not verified"); return "ignored"; }
  const conn = await d.store.getConnection(row.integrationId);
  if (!conn || IGNORABLE.has(conn.status)) { await inbox.mark(id, "ignored", "connection unavailable"); return "ignored"; }
  const def = getConnector(row.connectorId);
  if (!def?.webhook) { await inbox.mark(id, "ignored", "connector has no webhook handler"); return "ignored"; }
  const runId = await d.store.startRun({ connectionId: conn.id, tenantId: conn.tenantId, workspaceId: conn.workspaceId, kind: "webhook", stream: null, mode: conn.mode });
  let rejected = 0, count = 0;
  try {
    const secrets: ConnectionSecrets = await loadSecrets(d.vault, conn);
    const events = await def.webhook.verify({ rawBody: row.body, headers: row.headers }, secrets);
    const ctx: SyncContext = {
      conn, runId, log: d.log, apiBase: apiBaseFor(def, d.env), http: httpFor(d, def), secrets: () => loadSecrets(d.vault, conn as ConnectionRow),
      reject: () => { rejected++; },
      upsert: makeUpserter({ store: d.store, conn, defaults: def.defaultFieldMap, tenantMap: await d.store.getFieldMap(conn.id), log: d.log, onFieldReject: () => { rejected++; } }),
    };
    for (const evt of events) { await def.webhook.handle(ctx, evt); count++; }
    await d.store.finishRun(runId, { status: rejected ? "partial" : "success", rowsIn: count, rowsOut: 0, rowsRejected: rejected, error: null });
    await inbox.mark(id, "processed", null);
    return "processed";
  } catch (e) {
    const msg = safeError(e, 200);   // scrubbed: no body, no secrets
    await d.store.finishRun(runId, { status: "failed", rowsIn: count, rowsOut: 0, rowsRejected: rejected, error: `Inbound webhook failed: ${msg}` }).catch(() => undefined);
    await inbox.mark(id, "failed", msg);
    return "failed";
  }
}

/** Owner replay of a failed or ignored delivery: back to 'queued'; the caller enqueues. */
export async function replayInbound(inbox: ProcessStore, id: number): Promise<boolean> {
  const row = await inbox.getInbox(id);
  if (!row || !row.signatureOk || row.body === null) return false;
  await inbox.mark(id, "queued", null);
  return true;
}

type Make = (db: SupabaseClient, log: RuntimeDeps["log"]) => { d: RuntimeDeps; inbox: ProcessStore };
let factory: Make | null = null;
export function setProcessFactory(f: Make | null): void { factory = f; }

export const inboundHandler: JobHandler<InboundPayload> = async (p, ctx) => {
  let made;
  if (factory) made = factory(ctx.db, ctx.log);
  else { const m = await import("./runtime"); made = m.processDeps(ctx.db, ctx.log); }
  const out = await processInbound(made.d, made.inbox, p.inbox_id);
  // A failed row is retried by the queue; on the last attempt it stays 'failed' (visible dead letter) and the message goes to the DLQ.
  return out === "failed" && ctx.attempt < MAX_ATTEMPTS ? "retry" : "done";
};
registerHandler<InboundPayload>("connector_inbound", "*", inboundHandler);
