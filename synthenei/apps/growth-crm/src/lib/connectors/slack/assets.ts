// Channel picker after the OAuth connect. Server-side only: the browser sends a channel id and the alert switches, never a token; the id is
// re-checked against what Slack says the bot can see (Slack's answer, not the request's claim). The choice is stored in the connection's
// Vault bundle, the signing secret for inbound Slack requests goes into the webhook bundle, and the change is audited (audit or nothing).
// Callers (server actions, not in this task's Owns) must hold `integrations.manage` and pass deps from requestRuntime(audit).
import type { RuntimeDeps } from "../core/ports";
import { loadSecrets, saveSecrets } from "../core/secrets";
import { CredentialError, type ConnectionSecrets } from "../core/types";
import { buildTestMessage, serializeAlerts, settingsOf, ALERT_KEYS, type Locale } from "./alerts";
import { gatewayFor } from "./config";
import { CRED, SLACK_CONNECTOR_ID, SLACK_ENV, WEBHOOK_KEYS } from "./constants";
import { SlackChannelError, type ChannelAsset, type SlackGateway } from "./gateway";

export type AssetFail = "not_found" | "not_connected" | "token_rejected" | "channel_not_available" | "cannot_join" | "no_channel" | "vault_failed" | "audit_failed";
export type AssetResult<T> = { ok: true; value: T } | { ok: false; code: AssetFail };
export interface Actor { uid: string; tenantId: string; workspaceId: string }
export interface ChannelChoice { channelId: string; alerts?: string[]; includeNames?: boolean; locale?: Locale }
export interface Selected { channelName: string; teamName: string; alerts: string[] }

const MAX_PAGES = 10;

async function connectionOf(d: RuntimeDeps, actor: Actor, id: string) {
  const conn = await d.store.getConnection(id);
  // A connection of another workspace or tenant looks exactly like a missing one.
  if (!conn || conn.connectorId !== SLACK_CONNECTOR_ID || conn.workspaceId !== actor.workspaceId || conn.tenantId !== actor.tenantId) return null;
  return conn;
}
const usable = (s: string) => s !== "disconnected" && s !== "not_configured";

async function allChannels(gw: SlackGateway): Promise<ChannelAsset[]> {
  const out: ChannelAsset[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await gw.listChannels(cursor);
    out.push(...page.channels);
    if (!page.next) break;
    cursor = page.next;
  }
  return out;
}

/** What the connected workspace offers: names, ids and privacy only (the token never leaves the server). */
export async function listSlackChannels(d: RuntimeDeps, actor: Actor, connectionId: string, fetchImpl?: typeof fetch): Promise<AssetResult<ChannelAsset[]>> {
  const conn = await connectionOf(d, actor, connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId || !usable(conn.status)) return { ok: false, code: "not_connected" };
  try { return { ok: true, value: await allChannels(gatewayFor({ connectionId: conn.id, secrets: await loadSecrets(d.vault, conn), env: d.env, fetchImpl })) }; }
  catch (e) { if (e instanceof CredentialError) return { ok: false, code: "token_rejected" }; throw e; }
}

export async function selectSlackChannel(d: RuntimeDeps, actor: Actor, connectionId: string, choice: ChannelChoice, fetchImpl?: typeof fetch): Promise<AssetResult<Selected>> {
  const conn = await connectionOf(d, actor, connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId || !usable(conn.status)) return { ok: false, code: "not_connected" };
  const base = await loadSecrets(d.vault, conn);
  try {
    const gw = gatewayFor({ connectionId: conn.id, secrets: base, env: d.env, fetchImpl });
    // 1. The id must be one the bot can see, as Slack reports it.
    const ch = (await allChannels(gw)).find((c) => c.id === choice.channelId);
    if (!ch) return { ok: false, code: "channel_not_available" };
    // 2. A public channel the bot is not in is joined now, so the first alert cannot fail on membership.
    if (!ch.isMember) {
      try { await gw.join(ch.id); } catch (e) { if (e instanceof SlackChannelError) return { ok: false, code: "cannot_join" }; throw e; }
    }
    const team = await gw.authTest();

    // 3. Secrets: the credential bundle with the chosen channel, switches and team; the signing secret for inbound Slack requests.
    const prev = settingsOf(base);
    const alerts = serializeAlerts(choice.alerts ?? (base[CRED.alerts] !== undefined ? prev.alerts : [...ALERT_KEYS]));
    const bundle: ConnectionSecrets = {
      ...base, [CRED.channelId]: ch.id, [CRED.channelName]: ch.name, [CRED.teamId]: team.teamId, [CRED.teamName]: team.teamName, [CRED.botUserId]: team.botUserId,
      [CRED.alerts]: alerts, [CRED.includeNames]: (choice.includeNames ?? prev.includeNames) ? "1" : "0", [CRED.locale]: choice.locale ?? prev.locale,
    };
    let credId: string, hookId: string | null = conn.webhookSecretId;
    try {
      credId = await saveSecrets(d.vault, conn.id, bundle, conn.credentialSecretId);
      const signing = (d.env[SLACK_ENV.signingSecret] ?? "").trim();
      if (signing) hookId = await saveSecrets(d.vault, conn.id, { [WEBHOOK_KEYS.signingSecret]: signing }, conn.webhookSecretId, "webhook");
    } catch { return { ok: false, code: "vault_failed" }; }
    // A connection parked because the old channel vanished is healthy again once a working channel is chosen.
    const heal = conn.status === "needs_attention" || conn.status === "error" ? { status: conn.mode === "live" ? ("connected" as const) : ("sandbox" as const) } : {};
    await d.store.updateConnection(conn.id, { credentialSecretId: credId, webhookSecretId: hookId, externalAccountId: team.teamId || null, externalAccountLabel: team.teamName || null, lastError: null, ...heal });
    if (d.audit) {
      try { await d.audit({ action: "slack.channel_selected", summary: `Selected Slack channel for alerts`, connectionId: conn.id, detail: { channel: ch.id, private: ch.isPrivate, alerts, include_names: bundle[CRED.includeNames] === "1" } }); }
      catch { return { ok: false, code: "audit_failed" }; }
    }
    return { ok: true, value: { channelName: ch.name, teamName: team.teamName, alerts: alerts ? alerts.split(",") : [] } };
  } catch (e) {
    if (e instanceof CredentialError) return { ok: false, code: "token_rejected" };
    throw e;
  }
}

/** Posts a test alert to the chosen channel so the owner sees it works. A dead token flips the connection to needs_attention. */
export async function sendSlackTest(d: RuntimeDeps, actor: Actor, connectionId: string, fetchImpl?: typeof fetch): Promise<AssetResult<{ sent: true }>> {
  const conn = await connectionOf(d, actor, connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId || !usable(conn.status)) return { ok: false, code: "not_connected" };
  const secrets = await loadSecrets(d.vault, conn);
  const s = settingsOf(secrets);
  if (!s.channelId) return { ok: false, code: "no_channel" };
  const m = buildTestMessage(s.locale, d.env.APP_BASE_URL);
  try {
    await gatewayFor({ connectionId: conn.id, secrets, env: d.env, fetchImpl }).post({ channel: s.channelId, text: m.text, blocks: m.blocks });
    return { ok: true, value: { sent: true } };
  } catch (e) {
    if (e instanceof CredentialError) { await d.store.updateConnection(conn.id, { status: "needs_attention", lastError: "Slack rejected the token; reconnect Slack." }); return { ok: false, code: "token_rejected" }; }
    if (e instanceof SlackChannelError) return { ok: false, code: "channel_not_available" };
    throw e;
  }
}
