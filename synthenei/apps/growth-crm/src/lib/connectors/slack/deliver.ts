// Alert delivery (queue connector_sync, kind slack.alert). One job = one event for one Slack connection.
// Isolation: the connection must belong to the event's workspace; the token, channel and switches all come from THAT connection's Vault
// bundle. A revoked token flips the connection to needs_attention (never silent) and stops further posts until the owner reconnects.
import { safeError } from "../core/pii";
import { loadSecrets } from "../core/secrets";
import { CredentialError, TransientError, type ConnectionRow } from "../core/types";
import { alertForEvent, buildAlert, settingsOf, type EventFacts } from "./alerts";
import { gatewayFor } from "./config";
import { ALERT_RATE, SLACK_CONNECTOR_ID } from "./constants";
import { SlackChannelError } from "./gateway";
import type { SlackDeps } from "./store";

export interface AlertJob {
  connection_id: string; workspace_id: string; type: string; event_id: string; object_type: string | null; object_id: string | null;
  /** Whitelisted, non-PII facts copied from the event (connector, stream, reason). */
  data?: { connector?: string; stream?: string; reason?: string };
}
export type AlertOutcome = "posted" | "skipped" | "dropped" | "needs_attention" | "retry";

const RUNNABLE = new Set(["connected", "sandbox"]);

/** Flips a connection to needs_attention with a readable reason and tells the bus (best effort). Never throws. */
export async function flagNeedsAttention(d: SlackDeps, conn: ConnectionRow, reason: string, code: string): Promise<void> {
  try { await d.core.updateConnection(conn.id, { status: "needs_attention", lastError: reason }); } catch (e) { d.log.error("slack: could not flag connection", { connection: conn.id, error: safeError(e) }); return; }
  try { await d.emit?.({ type: "connector.sync.failed", workspaceId: conn.workspaceId, objectId: conn.id, data: { connector: SLACK_CONNECTOR_ID, reason: code } }); } catch { /* best effort */ }
}

export async function deliverAlertDetailed(d: SlackDeps, job: AlertJob): Promise<AlertOutcome> {
  const key = alertForEvent(job.type);
  if (!key) return "skipped";
  const conn = await d.core.getConnection(job.connection_id);
  // A connection of another workspace looks exactly like a missing one: nothing is sent.
  if (!conn || conn.connectorId !== SLACK_CONNECTOR_ID || conn.workspaceId !== job.workspace_id) return "skipped";
  if (!conn.credentialSecretId || !RUNNABLE.has(conn.status)) return "skipped";
  // Our own failures must not echo back into the channel that may already be broken.
  if (key === "sync_failed" && job.object_id === conn.id) return "skipped";

  const secrets = await loadSecrets(d.vault, conn);
  const s = settingsOf(secrets);
  if (!s.channelId || !s.alerts.includes(key)) return "skipped";
  if (!(await d.rate(`slack:${conn.id}`, ALERT_RATE.limit, ALERT_RATE.windowMs))) { d.log.warn("slack alert dropped by rate cap", { connection: conn.id, type: job.type }); return "dropped"; }

  const event: EventFacts = { type: job.type, objectType: job.object_type, objectId: job.object_id, data: job.data ?? {} };
  const subject = job.object_type && job.object_id && key !== "sync_failed" ? await d.store.describe(conn.workspaceId, job.object_type, job.object_id, s.includeNames) : null;
  const msg = buildAlert({ key, event, subject, settings: s, baseUrl: d.env.APP_BASE_URL });

  try {
    const gw = gatewayFor({ connectionId: conn.id, secrets, env: d.env, fetchImpl: d.fetchImpl });
    try { await gw.post({ channel: s.channelId, text: msg.text, blocks: msg.blocks }); }
    catch (e) {
      // The bot can lose channel membership (public channels: it may rejoin). One attempt, then the owner has to look.
      if (e instanceof SlackChannelError && e.code === "not_in_channel") { await gw.join(s.channelId); await gw.post({ channel: s.channelId, text: msg.text, blocks: msg.blocks }); }
      else throw e;
    }
    return "posted";
  } catch (e) {
    if (e instanceof CredentialError) { await flagNeedsAttention(d, conn, safeError(e), "token_revoked"); return "needs_attention"; }
    if (e instanceof SlackChannelError) { await flagNeedsAttention(d, conn, "Slack cannot post to the chosen channel (removed, archived or the app is not in it). Pick the channel again.", e.code); return "needs_attention"; }
    if (e instanceof TransientError) return "retry";
    throw e;
  }
}

export async function deliverAlert(d: SlackDeps, job: AlertJob): Promise<"done" | "retry"> {
  return (await deliverAlertDetailed(d, job)) === "retry" ? "retry" : "done";
}
