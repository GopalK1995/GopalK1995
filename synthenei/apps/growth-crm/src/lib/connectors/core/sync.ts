// Sync runner (scheduled + manual) and outbound push runner. Idempotent: a run already in flight for the same connection and
// stream is skipped, cursors advance page by page, and the upserter ignores records it has already stored unchanged.
// Every run writes a sync_runs row with a human-readable, PII-free error and a scrubbed sample (max 2 KB).
import { apiBaseFor, getConnector } from "../registry";
import { filterByConsent } from "./consent";
import { httpFor, refreshIfNeeded } from "./lifecycle";
import { safeError, stripPii } from "./pii";
import type { RuntimeDeps } from "./ports";
import { loadSecrets } from "./secrets";
import { makeUpserter } from "./upserter";
import { CredentialError, TransientError, type ConnectionRow, type ConnectorDef, type SyncContext } from "./types";

export const RUNNING_STALE_MS = 15 * 60_000;
export const MAX_PAGES_PER_RUN = 20;

export type RunTrigger = "poll" | "manual";
export interface StreamOutcome { stream: string; runId: number | null; status: "success" | "partial" | "failed" | "skipped"; rowsIn: number; rowsRejected: number; error?: string }
export interface SyncOutcome { connectionId: string; skipped?: "not_found" | "not_connected" | "not_available" | "unknown_connector" | "needs_attention"; streams: StreamOutcome[]; /** true when the job should be retried (transient vendor failure) */ retry: boolean }

const nowOf = (d: RuntimeDeps) => (d.now ? d.now() : new Date());

/** The connection may run when it has credentials and is in a working state. */
export function isRunnable(c: ConnectionRow): boolean {
  return !!c.credentialSecretId && (c.status === "connected" || c.status === "sandbox");
}

async function emitSafe(d: RuntimeDeps, type: "connector.sync.completed" | "connector.sync.failed", conn: ConnectionRow, data: Record<string, unknown>) {
  try { await d.emit?.({ type, workspaceId: conn.workspaceId, objectId: conn.id, data }); } catch { /* the bus is best effort; the sync_runs row is the record */ }
}

export async function runSync(d: RuntimeDeps, input: { connectionId: string; stream?: string; trigger: RunTrigger; startedBy?: string | null; deadlineMs?: number }): Promise<SyncOutcome> {
  const out: SyncOutcome = { connectionId: input.connectionId, streams: [], retry: false };
  let conn = await d.store.getConnection(input.connectionId);
  if (!conn) return { ...out, skipped: "not_found" };
  const def = getConnector(conn.connectorId);
  if (!def) return { ...out, skipped: "unknown_connector" };
  if (!isRunnable(conn)) return { ...out, skipped: conn.status === "needs_attention" ? "needs_attention" : "not_connected" };
  const availability = await d.store.getAvailability(def.id);
  if (!availability || availability.mode === "disabled") return { ...out, skipped: "not_available" };
  const effectiveMode = availability.mode === "live" && availability.gateStatus === "ready" && conn.mode === "live" ? "live" : "sandbox";

  const streams = def.streams.filter((s) => !input.stream || s.key === input.stream);
  const kind = input.trigger === "manual" ? "manual" : "poll";

  // Token refresh before any vendor call. A dead refresh token is a failed run the owner can read, and the connection needs attention.
  let refreshFailed: string | null = null;
  try {
    const r = await refreshIfNeeded(d, conn);
    if (!r.ok) refreshFailed = "The vendor connection expired and could not be renewed. Reconnect it to resume syncing.";
  } catch (e) {
    if (e instanceof TransientError) { out.retry = true; return out; }
    throw e;
  }
  if (refreshFailed) {
    for (const s of streams.length ? streams : [{ key: "-" }]) {
      const runId = await d.store.startRun({ connectionId: conn.id, tenantId: conn.tenantId, workspaceId: conn.workspaceId, kind, stream: s.key === "-" ? null : s.key, mode: effectiveMode, startedBy: input.startedBy });
      await d.store.finishRun(runId, { status: "failed", rowsIn: 0, rowsOut: 0, rowsRejected: 0, error: refreshFailed });
      out.streams.push({ stream: s.key, runId, status: "failed", rowsIn: 0, rowsRejected: 0, error: refreshFailed });
      await emitSafe(d, "connector.sync.failed", conn, { connector: def.id, stream: s.key, reason: "token_refresh_failed" });
    }
    return { ...out, skipped: "needs_attention" };
  }
  conn = (await d.store.getConnection(conn.id)) ?? conn;

  const tenantMap = await d.store.getFieldMap(conn.id);
  for (const stream of streams) {
    const stale = new Date(nowOf(d).getTime() - RUNNING_STALE_MS).toISOString();
    if (await d.store.findRunningRun(conn.id, stream.key, stale)) {
      out.streams.push({ stream: stream.key, runId: null, status: "skipped", rowsIn: 0, rowsRejected: 0 });
      continue;
    }
    const runId = await d.store.startRun({ connectionId: conn.id, tenantId: conn.tenantId, workspaceId: conn.workspaceId, kind, stream: stream.key, mode: effectiveMode, startedBy: input.startedBy });
    const rejectReasons: Record<string, number> = {};
    const reject = (reason: string) => { rejectReasons[reason] = (rejectReasons[reason] ?? 0) + 1; };
    const ctx: SyncContext = {
      conn, runId, log: d.log, apiBase: apiBaseFor(def, d.env), http: httpFor(d, def), secrets: () => loadSecrets(d.vault, conn!), reject,
      upsert: makeUpserter({ store: d.store, conn, defaults: def.defaultFieldMap, tenantMap, log: d.log, onFieldReject: reject }),
    };
    let cursor = await d.store.getCursor(conn.id, stream.key);
    let rowsIn = 0, rowsRejected = 0, pages = 0, sample: unknown = undefined;
    try {
      for (;;) {
        const r = await stream.run(ctx, cursor);
        rowsIn += r.rowsIn; rowsRejected += r.rowsRejected; cursor = r.cursor; pages++;
        if (r.sample !== undefined) sample = r.sample;
        await d.store.setCursor(conn.id, stream.key, cursor);   // progress survives a crash on the next page
        if (r.done || pages >= MAX_PAGES_PER_RUN || (input.deadlineMs && Date.now() > input.deadlineMs)) break;
      }
      const status = rowsRejected > 0 ? "partial" : "success";
      await d.store.finishRun(runId, { status, rowsIn, rowsOut: 0, rowsRejected, error: rowsRejected > 0 ? `${rowsRejected} row${rowsRejected === 1 ? "" : "s"} could not be imported` : null, payloadSample: stripPii({ rows: sample, rejected: rejectReasons }) });
      await d.store.updateConnection(conn.id, { lastSyncAt: nowOf(d).toISOString(), lastError: null });
      out.streams.push({ stream: stream.key, runId, status, rowsIn, rowsRejected });
      await emitSafe(d, "connector.sync.completed", conn, { connector: def.id, stream: stream.key, rows_in: rowsIn, rows_rejected: rowsRejected });
    } catch (e) {
      const msg = e instanceof CredentialError ? "The vendor rejected the saved credentials. Reconnect it to resume syncing." : e instanceof TransientError ? "The vendor is busy or unreachable. Syncing will retry." : `Sync stopped: ${safeError(e, 200)}`;
      await d.store.finishRun(runId, { status: "failed", rowsIn, rowsOut: 0, rowsRejected, error: msg, payloadSample: stripPii({ rejected: rejectReasons }) });
      if (e instanceof CredentialError) await d.store.updateConnection(conn.id, { status: "needs_attention", lastError: msg });
      else await d.store.updateConnection(conn.id, { lastError: msg });
      if (e instanceof TransientError) out.retry = true;
      out.streams.push({ stream: stream.key, runId, status: "failed", rowsIn, rowsRejected, error: msg });
      await emitSafe(d, "connector.sync.failed", conn, { connector: def.id, stream: stream.key });
    }
  }
  return out;
}

export interface PushOutcome { connectionId: string; pushKey: string; sent: number; skippedNoConsent: number; failed: number; skipped?: SyncOutcome["skipped"] | "unknown_push"; retry: boolean; runId: number | null }

/** Outbound push for lead ids. Marketing-purpose pushes only reach leads that pass public.can_contact(); the rest are counted as no_consent. */
export async function runPush(d: RuntimeDeps, input: { connectionId: string; pushKey: string; leadIds: string[]; payload?: unknown; startedBy?: string | null }): Promise<PushOutcome> {
  const base: PushOutcome = { connectionId: input.connectionId, pushKey: input.pushKey, sent: 0, skippedNoConsent: 0, failed: 0, retry: false, runId: null };
  const conn = await d.store.getConnection(input.connectionId);
  if (!conn) return { ...base, skipped: "not_found" };
  const def: ConnectorDef | undefined = getConnector(conn.connectorId);
  if (!def) return { ...base, skipped: "unknown_connector" };
  const push = def.pushes.find((p) => p.key === input.pushKey);
  if (!push) return { ...base, skipped: "unknown_push" };
  if (!isRunnable(conn)) return { ...base, skipped: "not_connected" };
  const availability = await d.store.getAvailability(def.id);
  if (!availability || availability.mode === "disabled") return { ...base, skipped: "not_available" };
  const effectiveMode = availability.mode === "live" && availability.gateStatus === "ready" && conn.mode === "live" ? "live" : "sandbox";

  const { allowed, skipped } = await filterByConsent(d.store, input.leadIds, push.consentPurpose);
  const runId = await d.store.startRun({ connectionId: conn.id, tenantId: conn.tenantId, workspaceId: conn.workspaceId, kind: "outbound", stream: `push:${push.key}`, mode: effectiveMode, startedBy: input.startedBy });
  let sent = 0, failed = 0, retry = false, lastErr: string | null = null;
  for (const leadId of allowed) {
    const ctx = {
      conn, runId, log: d.log, apiBase: apiBaseFor(def, d.env), http: httpFor(d, def), secrets: () => loadSecrets(d.vault, conn), contactId: leadId,
      upsert: makeUpserter({ store: d.store, conn, defaults: def.defaultFieldMap, tenantMap: [], log: d.log }),
    };
    try {
      const r = await push.run(ctx, input.payload);
      if (r.ok) sent++; else { failed++; lastErr = r.error ? safeError(r.error, 200) : "The vendor did not accept the message"; }
    } catch (e) {
      failed++;
      if (e instanceof CredentialError) { lastErr = "The vendor rejected the saved credentials. Reconnect it to resume sending."; await d.store.updateConnection(conn.id, { status: "needs_attention", lastError: lastErr }); break; }
      if (e instanceof TransientError) { retry = true; lastErr = "The vendor is busy or unreachable. Sending will retry."; break; }
      lastErr = `Push stopped: ${safeError(e, 200)}`;
    }
  }
  const status = failed > 0 && sent === 0 ? "failed" : failed > 0 || skipped.length > 0 ? "partial" : "success";
  await d.store.finishRun(runId, { status, rowsIn: 0, rowsOut: sent, rowsRejected: skipped.length + failed, error: lastErr ?? (skipped.length ? `${skipped.length} skipped: no consent` : null), payloadSample: stripPii({ rejected: { ...(skipped.length ? { no_consent: skipped.length } : {}), ...(failed ? { vendor_failed: failed } : {}) } }) });
  return { ...base, sent, skippedNoConsent: skipped.length, failed, retry, runId };
}
