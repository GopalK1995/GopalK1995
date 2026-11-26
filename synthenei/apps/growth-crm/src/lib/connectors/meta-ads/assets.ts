// Page + Instagram + ad account selection after the OAuth connect. Server-side only: the browser sends ids, never tokens; the ids are
// re-checked against what the connected user actually manages (Meta's answer, not the request's claim). One page / Instagram account
// belongs to one workspace platform-wide. Selection long-lives the user token, takes the page token, subscribes the page to the
// webhook, stores the webhook secret bundle (signing secret + hub.challenge token) and is audited.
import { randomToken } from "../core/oauth";
import type { RuntimeDeps } from "../core/ports";
import { loadSecrets, saveSecrets } from "../core/secrets";
import { CredentialError, TransientError, type ConnectionSecrets } from "../core/types";
import { gatewayFor } from "./config";
import { CRED, META_CONNECTOR_ID, META_ENV, WEBHOOK_KEYS } from "./constants";
import type { AdAccountAsset, PageAsset } from "./gateway";
import { healthFromDebug, type MetaHealth, type WebhookHealth } from "./health";
import type { MetaStore } from "./store";

export type AssetFail = "not_found" | "not_connected" | "not_configured" | "token_rejected" | "page_not_managed" | "ad_account_not_available" | "page_taken" | "ig_taken" | "vault_failed" | "audit_failed";
export type AssetResult<T> = { ok: true; value: T } | { ok: false; code: AssetFail };
export interface Actor { uid: string; tenantId: string; workspaceId: string }
export interface AssetChoice { pageId: string; adAccountId?: string }
export interface Selected { pageName: string; igUsername?: string; adAccountName?: string; /** false = Meta refused or was unreachable: instant leads and DMs are off until a retry works */ webhookSubscribed: boolean; /** the hub.challenge token to paste into the Meta app's webhook settings */ verifyToken: string }

async function connectionOf(d: RuntimeDeps, actor: Actor, id: string) {
  const conn = await d.store.getConnection(id);
  // A connection of another workspace or tenant looks exactly like a missing one.
  if (!conn || conn.connectorId !== META_CONNECTOR_ID || conn.workspaceId !== actor.workspaceId || conn.tenantId !== actor.tenantId) return null;
  return conn;
}
const usable = (s: string) => s !== "disconnected" && s !== "not_configured";

/** What the connected user can pick from: names and ids only (page tokens never leave the server). */
export async function listMetaAssets(d: RuntimeDeps, actor: Actor, connectionId: string, fetchImpl?: typeof fetch): Promise<AssetResult<{ pages: PageAsset[]; adAccounts: AdAccountAsset[] }>> {
  const conn = await connectionOf(d, actor, connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId || !usable(conn.status)) return { ok: false, code: "not_connected" };
  const gw = gatewayFor({ connectionId: conn.id, secrets: await loadSecrets(d.vault, conn), env: d.env, fetchImpl });
  try {
    const [pages, adAccounts] = [await gw.listPages(), await gw.listAdAccounts()];
    if (pages.length === 0) {
      // Diagnostic only (names of granted scopes, never tokens): why does Meta return no Pages for this login?
      let granted = "unknown";
      try { const dbg = await gw.debugToken(); granted = `valid=${dbg.valid} scopes=${dbg.scopes.join("|")}`; } catch { /* ignore */ }
      console.warn(`meta.listAssets: 0 pages, ${adAccounts.length} ad accounts; token ${granted}`);
    }
    return { ok: true, value: { pages: pages.map(({ pageToken: _t, ...p }) => p), adAccounts } };
  } catch (e) { if (e instanceof CredentialError) return { ok: false, code: "token_rejected" }; throw e; }
}

export async function selectMetaAssets(d: RuntimeDeps, meta: MetaStore, actor: Actor, connectionId: string, choice: AssetChoice, fetchImpl?: typeof fetch): Promise<AssetResult<Selected>> {
  const conn = await connectionOf(d, actor, connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId || !usable(conn.status)) return { ok: false, code: "not_connected" };
  const appSecret = (d.env[META_ENV.appSecret] ?? "").trim();
  if (!appSecret) return { ok: false, code: "not_configured" };
  const base = await loadSecrets(d.vault, conn);

  try {
    // 1. Long-lived user token first: page tokens taken from a short-lived one would be short-lived too.
    let userToken = base[CRED.accessToken] ?? "", expiresInSec: number | undefined;
    const first = gatewayFor({ connectionId: conn.id, secrets: base, env: d.env, fetchImpl });
    if (first.kind === "graph") { const x = await first.exchangeLongLived(); userToken = x.accessToken; expiresInSec = x.expiresInSec; }
    const withUser: ConnectionSecrets = { ...base, [CRED.accessToken]: userToken };
    const gw = first.kind === "graph" ? gatewayFor({ connectionId: conn.id, secrets: withUser, env: d.env, fetchImpl }) : first;

    // 2. The ids must be ones this user manages, as Meta reports them.
    const page = (await gw.listPages()).find((p) => p.id === choice.pageId);
    if (!page) return { ok: false, code: "page_not_managed" };
    let ad: AdAccountAsset | undefined;
    if (choice.adAccountId) {
      ad = (await gw.listAdAccounts()).find((a) => a.id === choice.adAccountId);
      if (!ad) return { ok: false, code: "ad_account_not_available" };
    }

    // 3. Platform-wide ownership: refuse before anything is subscribed or stored.
    const reg = await meta.registerAssets({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, connectionId: conn.id, pageId: page.id, pageName: page.name, igUserId: page.igUserId, igUsername: page.igUsername, adAccountId: ad?.id, adAccountName: ad?.name, currency: ad?.currency || undefined });
    if (!reg.ok) return { ok: false, code: reg.reason };

    // 4. Webhook subscription: leads always, Instagram messages when an Instagram account is linked.
    // Best effort: webhooks need leads_retrieval / pages_manage_metadata. Without them (e.g. a Meta app that has no Lead Ads use case yet)
    // the page is still stored and the metrics sync (polling) works; only instant lead and DM delivery is off until the scopes exist.
    // INTG-011: a failure here used to be a console.warn only, so the chip said Connected while instant leads and DMs were dead.
    // It is now recorded (integrations.health.meta.webhook) and shown on the integration page with a retry action.
    const nowIso = (d.now ? d.now() : new Date()).toISOString();
    let webhook: WebhookHealth;
    try { await gw.subscribePage(page.id, page.pageToken, page.igUserId ? ["leadgen", "messages"] : ["leadgen"]); webhook = { subscribed: true, error: null, at: nowIso }; }
    catch (e) {
      webhook = { subscribed: false, error: e instanceof CredentialError ? "missing_permission" : "meta_unreachable", at: nowIso };
      console.warn("meta.subscribePage failed:", webhook.error);
    }

    // 5. Secrets: credential bundle (tokens + chosen ids) and the webhook bundle the edge verifies with.
    let verifyToken = "";
    if (conn.webhookSecretId) { try { verifyToken = String((JSON.parse((await d.vault.getSecret(conn.webhookSecretId)) ?? "{}") as Record<string, unknown>)[WEBHOOK_KEYS.verifyToken] ?? ""); } catch { /* new token below */ } }
    verifyToken ||= randomToken(24);
    const bundle: ConnectionSecrets = { ...withUser, [CRED.refreshToken]: userToken, [CRED.pageId]: page.id, [CRED.pageToken]: page.pageToken };
    delete bundle[CRED.igUserId]; delete bundle[CRED.adAccountId];
    if (page.igUserId) bundle[CRED.igUserId] = page.igUserId;
    if (ad) bundle[CRED.adAccountId] = ad.id;
    let credId: string, hookId: string;
    try {
      credId = await saveSecrets(d.vault, conn.id, bundle, conn.credentialSecretId);
      hookId = await saveSecrets(d.vault, conn.id, { [WEBHOOK_KEYS.appSecret]: appSecret, [WEBHOOK_KEYS.verifyToken]: verifyToken }, conn.webhookSecretId, "webhook");
    } catch { return { ok: false, code: "vault_failed" }; }
    // The long-lived exchange does not always return expires_in (it did not on the live connection): ask debug_token for the real dates.
    let health: MetaHealth | null = null;
    try { health = healthFromDebug(await gw.debugToken(), d.now ? d.now() : new Date(), webhook); } catch { /* app credentials missing or Meta down: the daily health check fills it in */ }
    if (!expiresInSec && health?.tokenExpiresAt) expiresInSec = Math.max(1, Math.floor((Date.parse(health.tokenExpiresAt) - (d.now ? d.now() : new Date()).getTime()) / 1000));
    await d.store.updateConnection(conn.id, {
      credentialSecretId: credId, webhookSecretId: hookId, externalAccountId: page.id, externalAccountLabel: page.name, lastError: null,
      ...(expiresInSec ? { tokenExpiresAt: new Date((d.now ? d.now() : new Date()).getTime() + expiresInSec * 1000).toISOString() } : {}),
    });
    if (meta.recordHealth) { try { await meta.recordHealth(conn.id, { health: health ?? { webhook, checkedAt: nowIso } }); } catch { /* health is advisory */ } }
    if (d.audit) {
      try { await d.audit({ action: "meta.assets_selected", summary: `Selected Meta page${page.igUserId ? ", Instagram account" : ""}${ad ? " and ad account" : ""}`, connectionId: conn.id, detail: { page: page.id, instagram: !!page.igUserId, ad_account: !!ad } }); }
      catch { return { ok: false, code: "audit_failed" }; }
    }
    return { ok: true, value: { pageName: page.name, igUsername: page.igUsername, adAccountName: ad?.name, verifyToken, webhookSubscribed: webhook.subscribed } };
  } catch (e) {
    if (e instanceof CredentialError) { console.warn("meta.selectAssets rejected:", String(e.message).slice(0, 200)); return { ok: false, code: "token_rejected" }; }
    if (e instanceof TransientError) throw e;
    throw e;
  }
}

/** Re-runs the page subscription with the stored page token (the "Retry" action on the integration page). The outcome is recorded either way. */
export async function retryWebhookSubscription(d: RuntimeDeps, meta: MetaStore, actor: Actor, connectionId: string, fetchImpl?: typeof fetch): Promise<AssetResult<{ subscribed: boolean }>> {
  const conn = await connectionOf(d, actor, connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId || !usable(conn.status)) return { ok: false, code: "not_connected" };
  const secrets = await loadSecrets(d.vault, conn);
  const pageId = secrets[CRED.pageId], pageToken = secrets[CRED.pageToken];
  if (!pageId || !pageToken) return { ok: false, code: "not_connected" };
  const gw = gatewayFor({ connectionId: conn.id, secrets, env: d.env, fetchImpl });
  const at = (d.now ? d.now() : new Date()).toISOString();
  let webhook: WebhookHealth;
  try { await gw.subscribePage(pageId, pageToken, secrets[CRED.igUserId] ? ["leadgen", "messages"] : ["leadgen"]); webhook = { subscribed: true, error: null, at }; }
  catch (e) { webhook = { subscribed: false, error: e instanceof CredentialError ? "missing_permission" : "meta_unreachable", at }; }
  if (meta.recordHealth) await meta.recordHealth(conn.id, { health: { webhook, checkedAt: at } });
  if (d.audit) { try { await d.audit({ action: "meta.webhook_retry", summary: webhook.subscribed ? "Retried the Meta webhook subscription: subscribed" : "Retried the Meta webhook subscription: still failing", connectionId: conn.id, detail: { subscribed: webhook.subscribed, error: webhook.error } }); } catch { /* best effort */ } }
  return { ok: true, value: { subscribed: webhook.subscribed } };
}
