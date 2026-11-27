// Page + Instagram + ad account selection after the OAuth connect. Server-side only: the browser sends ids, never tokens; the ids are
// re-checked against what the connected user actually manages (Meta's answer, not the request's claim). One page / Instagram account
// belongs to one workspace platform-wide. Selection long-lives the user token, takes the page token, subscribes the page to the
// webhook, stores the webhook secret bundle (signing secret + hub.challenge token) and is audited.
import { randomToken } from "../core/oauth";
import type { RuntimeDeps } from "../core/ports";
import { loadSecrets, saveSecrets } from "../core/secrets";
import { CredentialError, type ConnectionSecrets } from "../core/types";
import { gatewayFor } from "./config";
import { CRED, META_CONNECTOR_ID, META_ENV, WEBHOOK_KEYS } from "./constants";
import type { AdAccountAsset, PageAsset } from "./gateway";
import { healthFromDebug, type MetaHealth, type WebhookHealth } from "./health";
import { pagesOf, withPages } from "./pages";
import type { MetaStore } from "./store";

export type AssetFail = "not_found" | "not_connected" | "not_configured" | "token_rejected" | "page_not_managed" | "ad_account_not_available" | "page_taken" | "ig_taken" | "vault_failed" | "audit_failed";
export type AssetResult<T> = { ok: true; value: T } | { ok: false; code: AssetFail };
export interface Actor { uid: string; tenantId: string; workspaceId: string }
/** Most Pages one request can add (the picker lists what Meta granted; this only bounds a hand-made request). */
export const MAX_PAGES = 25;
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
export async function listMetaAssets(d: RuntimeDeps, actor: Actor, connectionId: string, fetchImpl?: typeof fetch): Promise<AssetResult<{ pages: PageAsset[]; adAccounts: AdAccountAsset[]; /** ids of the Pages this connection already tracks (AUD-100) */ connected: string[] }>> {
  const conn = await connectionOf(d, actor, connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId || !usable(conn.status)) return { ok: false, code: "not_connected" };
  const secrets = await loadSecrets(d.vault, conn);
  const gw = gatewayFor({ connectionId: conn.id, secrets, env: d.env, fetchImpl });
  try {
    const [pages, adAccounts] = [await gw.listPages(), await gw.listAdAccounts()];
    if (pages.length === 0) {
      // Diagnostic only (names of granted scopes, never tokens): why does Meta return no Pages for this login?
      let granted = "unknown";
      try { const dbg = await gw.debugToken(); granted = `valid=${dbg.valid} scopes=${dbg.scopes.join("|")}`; } catch { /* ignore */ }
      console.warn(`meta.listAssets: 0 pages, ${adAccounts.length} ad accounts; token ${granted}`);
    }
    return { ok: true, value: { pages: pages.map(({ pageToken: _t, ...p }) => p), adAccounts, connected: pagesOf(secrets).map((p) => p.id) } };
  } catch (e) { if (e instanceof CredentialError) return { ok: false, code: "token_rejected" }; throw e; }
}

/** What happened to one requested Page (AUD-100): a failure of one never blocks the others. */
export type PageOutcome = { pageId: string; ok: true; pageName: string; igUsername?: string; webhookSubscribed: boolean } | { pageId: string; ok: false; code: AssetFail };
export interface PagesSelected { results: PageOutcome[]; adAccountName?: string; verifyToken: string; /** every Page the connection now tracks, primary first (a name can be missing for a Page saved before names were kept) */ pages: { id: string; name?: string; igUsername?: string }[] }
type PageWebhook = { id: string; subscribed: boolean; error: string | null };

/**
 * AUD-100: connects one or several Pages (each with its linked Instagram account) to the connection, APPENDING to the ones already there.
 * Each Page is checked against what Meta says the user manages, claimed platform-wide (one Page never feeds two workspaces), subscribed to the
 * webhook and given its own page token in the credential bundle. A Page that fails (not managed, taken elsewhere) is reported per Page and
 * the others still go through; the call fails as a whole only when no Page could be added or the vault refused the save.
 */
export async function connectMetaPages(d: RuntimeDeps, meta: MetaStore, actor: Actor, connectionId: string, choice: { pageIds: string[]; adAccountId?: string }, fetchImpl?: typeof fetch): Promise<AssetResult<PagesSelected>> {
  const conn = await connectionOf(d, actor, connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId || !usable(conn.status)) return { ok: false, code: "not_connected" };
  const appSecret = (d.env[META_ENV.appSecret] ?? "").trim();
  if (!appSecret) return { ok: false, code: "not_configured" };
  const wanted = [...new Set(choice.pageIds.map((x) => x.trim()).filter(Boolean))].slice(0, MAX_PAGES);
  if (!wanted.length) return { ok: false, code: "page_not_managed" };
  const base = await loadSecrets(d.vault, conn);

  try {
    // 1. Long-lived user token first: page tokens taken from a short-lived one would be short-lived too.
    let userToken = base[CRED.accessToken] ?? "", expiresInSec: number | undefined;
    const first = gatewayFor({ connectionId: conn.id, secrets: base, env: d.env, fetchImpl });
    if (first.kind === "graph") { const x = await first.exchangeLongLived(); userToken = x.accessToken; expiresInSec = x.expiresInSec; }
    const withUser: ConnectionSecrets = { ...base, [CRED.accessToken]: userToken };
    const gw = first.kind === "graph" ? gatewayFor({ connectionId: conn.id, secrets: withUser, env: d.env, fetchImpl }) : first;

    // 2. The ids must be ones this user manages, as Meta reports them.
    const granted = await gw.listPages();
    let ad: AdAccountAsset | undefined;
    if (choice.adAccountId) {
      ad = (await gw.listAdAccounts()).find((a) => a.id === choice.adAccountId);
      if (!ad) return { ok: false, code: "ad_account_not_available" };
    }

    const nowIso = (d.now ? d.now() : new Date()).toISOString();
    const existing = pagesOf(base);
    const kept = new Map(existing.map((p) => [p.id, p]));
    const results: PageOutcome[] = [];
    const webhookByPage = new Map<string, { subscribed: boolean; error: string | null }>();
    for (const pageId of wanted) {
      const page = granted.find((p) => p.id === pageId);
      if (!page) { results.push({ pageId, ok: false, code: "page_not_managed" }); continue; }
      // 3. Platform-wide ownership: refuse before anything is subscribed or stored.
      const reg = await meta.registerAssets({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, connectionId: conn.id, pageId: page.id, pageName: page.name, igUserId: page.igUserId, igUsername: page.igUsername, adAccountId: ad?.id, adAccountName: ad?.name, currency: ad?.currency || undefined, append: true });
      if (!reg.ok) { results.push({ pageId, ok: false, code: reg.reason }); continue; }
      // 4. Webhook subscription: leads always, Instagram messages when an Instagram account is linked.
      // Best effort: webhooks need leads_retrieval / pages_manage_metadata. Without them (e.g. a Meta app that has no Lead Ads use case yet)
      // the page is still stored and the metrics sync (polling) works; only instant lead and DM delivery is off until the scopes exist.
      // INTG-011: the outcome is recorded (integrations.health.meta.webhook, per Page) and shown on the integration page with a retry action.
      try { await gw.subscribePage(page.id, page.pageToken, page.igUserId ? ["leadgen", "messages"] : ["leadgen"]); webhookByPage.set(page.id, { subscribed: true, error: null }); }
      catch (e) { webhookByPage.set(page.id, { subscribed: false, error: e instanceof CredentialError ? "missing_permission" : "meta_unreachable" }); console.warn("meta.subscribePage failed:", webhookByPage.get(page.id)!.error); }
      kept.set(page.id, { id: page.id, token: page.pageToken, igUserId: page.igUserId, name: page.name, igUsername: page.igUsername });
      results.push({ pageId, ok: true, pageName: page.name, igUsername: page.igUsername, webhookSubscribed: webhookByPage.get(page.id)!.subscribed });
    }
    const added = results.filter((r): r is Extract<PageOutcome, { ok: true }> => r.ok);
    if (!added.length) return { ok: false, code: (results[0] as Extract<PageOutcome, { ok: false }>).code };

    // 5. Secrets: credential bundle (tokens + every chosen Page) and the webhook bundle the edge verifies with.
    // The primary (first) Page stays first, so the single-page keys keep pointing at the Page that was connected before.
    const pages = [...existing.map((p) => kept.get(p.id)!), ...[...kept.values()].filter((p) => !existing.some((e) => e.id === p.id))];
    let verifyToken = "";
    if (conn.webhookSecretId) { try { verifyToken = String((JSON.parse((await d.vault.getSecret(conn.webhookSecretId)) ?? "{}") as Record<string, unknown>)[WEBHOOK_KEYS.verifyToken] ?? ""); } catch { /* new token below */ } }
    verifyToken ||= randomToken(24);
    const bundle: ConnectionSecrets = withPages({ ...withUser, [CRED.refreshToken]: userToken }, pages);
    if (ad) bundle[CRED.adAccountId] = ad.id;   // a selection without an ad account keeps the one already linked
    let credId: string, hookId: string;
    try {
      credId = await saveSecrets(d.vault, conn.id, bundle, conn.credentialSecretId);
      hookId = await saveSecrets(d.vault, conn.id, { [WEBHOOK_KEYS.appSecret]: appSecret, [WEBHOOK_KEYS.verifyToken]: verifyToken }, conn.webhookSecretId, "webhook");
    } catch { return { ok: false, code: "vault_failed" }; }
    // Webhook state for the health block: the Pages that were already there keep their last known state, the new ones carry this run's.
    const merged = new Map((await storedWebhook(meta, conn.id, pagesOf(base)[0]?.id)).map((p) => [p.id, p]));
    for (const [id, w] of webhookByPage) merged.set(id, { id, ...w });
    const webhook = webhookHealth(pages.map((p) => p.id), merged, nowIso);
    // The long-lived exchange does not always return expires_in (it did not on the live connection): ask debug_token for the real dates.
    let health: MetaHealth | null = null;
    try { health = healthFromDebug(await gw.debugToken(), d.now ? d.now() : new Date(), webhook); } catch { /* app credentials missing or Meta down: the daily health check fills it in */ }
    if (!expiresInSec && health?.tokenExpiresAt) expiresInSec = Math.max(1, Math.floor((Date.parse(health.tokenExpiresAt) - (d.now ? d.now() : new Date()).getTime()) / 1000));
    await d.store.updateConnection(conn.id, {
      credentialSecretId: credId, webhookSecretId: hookId, lastError: null,
      // The connection's label names the primary Page: only set when this is the first Page the connection ever tracked.
      ...(existing.length ? {} : { externalAccountId: pages[0]!.id, externalAccountLabel: pages[0]!.name ?? null }),
      ...(expiresInSec ? { tokenExpiresAt: new Date((d.now ? d.now() : new Date()).getTime() + expiresInSec * 1000).toISOString() } : {}),
    });
    if (meta.recordHealth) { try { await meta.recordHealth(conn.id, { health: health ?? { webhook, checkedAt: nowIso } }); } catch { /* health is advisory */ } }
    if (d.audit) {
      try { await d.audit({ action: "meta.assets_selected", summary: `Selected ${added.length} Meta page${added.length === 1 ? "" : "s"}${added.some((r) => r.igUsername) ? ", Instagram account" : ""}${ad ? " and ad account" : ""}`, connectionId: conn.id, detail: { pages: added.length, instagram: added.filter((r) => !!r.igUsername).length, ad_account: !!ad, failed: results.length - added.length } }); }
      catch { return { ok: false, code: "audit_failed" }; }
    }
    return { ok: true, value: { results, adAccountName: ad?.name, verifyToken, pages: pages.map((p) => ({ id: p.id, name: p.name, igUsername: p.igUsername })) } };
  } catch (e) {
    if (e instanceof CredentialError) { console.warn("meta.selectAssets rejected:", String(e.message).slice(0, 200)); return { ok: false, code: "token_rejected" }; }
    throw e;
  }
}

/** The one-Page entry point (kept for callers and tests that pick a single Page): appends the Page, like the multi-Page flow. */
export async function selectMetaAssets(d: RuntimeDeps, meta: MetaStore, actor: Actor, connectionId: string, choice: AssetChoice, fetchImpl?: typeof fetch): Promise<AssetResult<Selected>> {
  const r = await connectMetaPages(d, meta, actor, connectionId, { pageIds: [choice.pageId], adAccountId: choice.adAccountId }, fetchImpl);
  if (!r.ok) return r;
  const o = r.value.results[0];
  if (!o || !o.ok) return { ok: false, code: o && !o.ok ? o.code : "page_not_managed" };
  return { ok: true, value: { pageName: o.pageName, igUsername: o.igUsername, adAccountName: r.value.adAccountName, verifyToken: r.value.verifyToken, webhookSubscribed: o.webhookSubscribed } };
}

/**
 * AUD-100: stops tracking one Page (and its Instagram account) without touching the others or the Meta login. Its page token is dropped
 * from the bundle, the Page is released for other workspaces, its synced numbers are kept but detached. The primary Page can be removed:
 * the next one takes its place in the single-page keys. Removing the last Page leaves the connection connected with nothing selected.
 */
export async function removeMetaPage(d: RuntimeDeps, meta: MetaStore, actor: Actor, connectionId: string, pageId: string): Promise<AssetResult<{ remaining: number }>> {
  const conn = await connectionOf(d, actor, connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId || !usable(conn.status)) return { ok: false, code: "not_connected" };
  const base = await loadSecrets(d.vault, conn);
  const pages = pagesOf(base), gone = pages.find((p) => p.id === pageId);
  if (!gone) return { ok: false, code: "not_found" };
  const rest = pages.filter((p) => p.id !== pageId);
  if (d.audit) { try { await d.audit({ action: "meta.page_removed", summary: "Removed a Meta page from the workspace", connectionId: conn.id, detail: { page: pageId, instagram: !!gone.igUserId, remaining: rest.length } }); } catch { return { ok: false, code: "audit_failed" }; } }
  if (meta.releaseAssets) await meta.releaseAssets({ workspaceId: conn.workspaceId, connectionId: conn.id, pageId, igUserId: gone.igUserId });
  let credId: string;
  try { credId = await saveSecrets(d.vault, conn.id, withPages(base, rest), conn.credentialSecretId); } catch { return { ok: false, code: "vault_failed" }; }
  const next = rest[0];
  // The connection's label names the primary Page: it only changes when the primary was the one removed.
  await d.store.updateConnection(conn.id, { credentialSecretId: credId, ...(gone.id === pages[0]!.id ? { externalAccountId: next?.id ?? null, externalAccountLabel: next?.name ?? null } : {}) });
  if (meta.recordHealth) {
    const nowIso = (d.now ? d.now() : new Date()).toISOString();
    const merged = new Map((await storedWebhook(meta, conn.id, pagesOf(base)[0]?.id)).map((p) => [p.id, p]));
    try { await meta.recordHealth(conn.id, { health: { webhook: webhookHealth(rest.map((p) => p.id), merged, nowIso), checkedAt: nowIso } }); } catch { /* advisory */ }
  }
  return { ok: true, value: { remaining: rest.length } };
}

/** The per-Page webhook state last recorded on the connection (empty when none or when the store cannot read it back). */
async function storedWebhook(meta: MetaStore, connectionId: string, primaryId?: string): Promise<PageWebhook[]> {
  if (!meta.readHealth) return [];
  try {
    const w = (await meta.readHealth(connectionId))?.webhook;
    if (!w) return [];
    if (w.pages) return w.pages;
    // Recorded before AUD-100: the single state belonged to the one Page the connection had.
    return primaryId ? [{ id: primaryId, subscribed: w.subscribed, error: w.error }] : [];
  } catch { return []; }
}
/** Connection-level webhook health from per-Page states: subscribed only when every tracked Page is; the first failing reason is shown. */
function webhookHealth(pageIds: string[], byPage: Map<string, PageWebhook>, at: string): WebhookHealth {
  const states = pageIds.map((id) => byPage.get(id) ?? { id, subscribed: false, error: null });
  const bad = states.find((s) => !s.subscribed);
  return { subscribed: states.length > 0 && !bad, error: bad?.error ?? null, at, ...(pageIds.length > 1 ? { pages: states } : {}) };
}

/** Re-runs the page subscription with the stored page token of EVERY connected Page (the "Retry" action on the integration page). The outcome is recorded per Page either way. */
export async function retryWebhookSubscription(d: RuntimeDeps, meta: MetaStore, actor: Actor, connectionId: string, fetchImpl?: typeof fetch): Promise<AssetResult<{ subscribed: boolean }>> {
  const conn = await connectionOf(d, actor, connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId || !usable(conn.status)) return { ok: false, code: "not_connected" };
  const secrets = await loadSecrets(d.vault, conn);
  const pages = pagesOf(secrets);
  if (!pages.length) return { ok: false, code: "not_connected" };
  const gw = gatewayFor({ connectionId: conn.id, secrets, env: d.env, fetchImpl });
  const at = (d.now ? d.now() : new Date()).toISOString();
  const states = new Map<string, PageWebhook>();
  for (const p of pages) {
    try { await gw.subscribePage(p.id, p.token, p.igUserId ? ["leadgen", "messages"] : ["leadgen"]); states.set(p.id, { id: p.id, subscribed: true, error: null }); }
    catch (e) { states.set(p.id, { id: p.id, subscribed: false, error: e instanceof CredentialError ? "missing_permission" : "meta_unreachable" }); }
  }
  const webhook = webhookHealth(pages.map((p) => p.id), states, at);
  if (meta.recordHealth) await meta.recordHealth(conn.id, { health: { webhook, checkedAt: at } });
  if (d.audit) { try { await d.audit({ action: "meta.webhook_retry", summary: webhook.subscribed ? "Retried the Meta webhook subscription: subscribed" : "Retried the Meta webhook subscription: still failing", connectionId: conn.id, detail: { subscribed: webhook.subscribed, error: webhook.error, pages: pages.length } }); } catch { /* best effort */ } }
  return { ok: true, value: { subscribed: webhook.subscribed } };
}
