// Connection lifecycle: connect / test / reconnect / disconnect / token refresh. Pure orchestration over the ports.
// Credentials go to the Vault and nowhere else: they are not returned, not logged, not put in errors or audit detail.
import { apiBaseFor, envConfigured, getConnector } from "../registry";
import { makeVendorHttp } from "./http";
import { refreshToken, type TokenResult } from "./oauth";
import { safeError } from "./pii";
import { loadSecrets, saveSecrets, dropSecrets } from "./secrets";
import type { RuntimeDeps } from "./ports";
import { deriveChip, modeForNewConnection } from "./status";
import { CredentialError, TransientError, type ConnectionRow, type ConnectionSecrets, type ConnectorDef } from "./types";

export type LifecycleFail =
  | "unknown_connector" | "not_available" | "not_configured" | "needs_vendor_approval" | "needs_client_credentials"
  | "already_connected" | "not_found" | "invalid_input" | "credentials_rejected" | "vault_failed" | "audit_failed" | "wrong_auth";
export type LifecycleResult<T = ConnectionRow> = { ok: true; value: T } | { ok: false; code: LifecycleFail; field?: string };

export interface Actor { uid: string; tenantId: string; workspaceId: string }
const ACTIVE = new Set(["connected", "sandbox", "needs_attention", "error"]);
const iso = (d: Date) => d.toISOString();
const nowOf = (d: RuntimeDeps) => (d.now ? d.now() : new Date());

export const httpFor = (d: RuntimeDeps, def: ConnectorDef) => (d.http ? d.http(def) : makeVendorHttp(def.rate, { fetch: d.fetchImpl }));

/** Checks required fields and patterns without echoing any value. */
export function validateCredentials(def: ConnectorDef, input: Record<string, string>): { ok: true; secrets: ConnectionSecrets } | { ok: false; field: string } {
  const out: ConnectionSecrets = {};
  for (const f of def.credentialFields ?? []) {
    const v = (input[f.key] ?? "").trim();
    if (!v || v.length > 4096) return { ok: false, field: f.key };
    if (f.pattern && !new RegExp(f.pattern).test(v)) return { ok: false, field: f.key };
    out[f.key] = v;
  }
  return { ok: true, secrets: out };
}

async function gate(d: RuntimeDeps, def: ConnectorDef, existing: ConnectionRow | null): Promise<{ ok: true; mode: "sandbox" | "live" } | { ok: false; code: LifecycleFail }> {
  const availability = await d.store.getAvailability(def.id);
  const chip = deriveChip({ availability, connection: null, envConfigured: envConfigured(def, d.env) });
  if (chip.blockReason) return { ok: false, code: chip.blockReason };
  const mode = modeForNewConnection(availability);
  if (!mode) return { ok: false, code: "not_available" };
  void existing;
  return { ok: true, mode };
}

async function audited(d: RuntimeDeps, e: { action: string; summary: string; connectionId: string; detail?: Record<string, unknown> }): Promise<boolean> {
  if (!d.audit) return true;
  try { await d.audit(e); return true; } catch { return false; }
}

/** Shared finish: store the bundle in the Vault, then flip the connection to its truthful state. */
async function finalize(d: RuntimeDeps, def: ConnectorDef, conn: ConnectionRow, secrets: ConnectionSecrets, opts: { expiresInSec?: number; scopes?: string[]; account?: { id?: string; label?: string }; mode: "sandbox" | "live"; uid: string; reconnect: boolean }): Promise<LifecycleResult> {
  let secretId: string;
  try { secretId = await saveSecrets(d.vault, conn.id, secrets, conn.credentialSecretId); } catch { return { ok: false, code: "vault_failed" }; }
  const now = nowOf(d);
  const status = opts.mode === "live" ? "connected" : "sandbox";
  await d.store.updateConnection(conn.id, {
    status, mode: opts.mode, credentialSecretId: secretId, lastError: null, disabledAt: null, connectedBy: opts.uid, connectedAt: iso(now),
    tokenExpiresAt: opts.expiresInSec ? iso(new Date(now.getTime() + opts.expiresInSec * 1000)) : null,
    externalAccountId: opts.account?.id ?? null, externalAccountLabel: opts.account?.label ?? null, oauthScopes: opts.scopes ?? null,
  });
  const ok = await audited(d, { action: opts.reconnect ? "connector.reconnected" : "connector.connected", summary: `${opts.reconnect ? "Reconnected" : "Connected"} ${def.name} (${opts.mode})`, connectionId: conn.id, detail: { connector: def.id, mode: opts.mode } });
  if (!ok) return { ok: false, code: "audit_failed" };
  return { ok: true, value: { ...conn, status, mode: opts.mode, credentialSecretId: secretId, lastError: null } };
}

async function ensureConnection(d: RuntimeDeps, def: ConnectorDef, actor: Actor, mode: "sandbox" | "live"): Promise<{ conn: ConnectionRow; existing: boolean } | "already_connected"> {
  const found = await d.store.findConnection(actor.workspaceId, def.id);
  if (found && found.credentialSecretId && ACTIVE.has(found.status) && found.status !== "needs_attention" && found.status !== "error") return "already_connected";
  if (found) return { conn: found, existing: true };
  const conn = await d.store.insertConnection({ tenantId: actor.tenantId, workspaceId: actor.workspaceId, connectorId: def.id, label: def.name, category: def.category, direction: def.capabilities.inbound && def.capabilities.outbound ? "both" : def.capabilities.outbound ? "out" : "in", mode, status: "not_configured", connectedBy: actor.uid });
  return { conn, existing: false };
}

/** api_key / service_account / none: verify the credentials with the vendor, then store them. */
export async function connectWithCredentials(d: RuntimeDeps, actor: Actor, connectorId: string, input: Record<string, string>): Promise<LifecycleResult> {
  const def = getConnector(connectorId);
  if (!def) return { ok: false, code: "unknown_connector" };
  if (def.auth === "oauth2") return { ok: false, code: "wrong_auth" };
  const g = await gate(d, def, null);
  if (!g.ok) return g;
  const v = validateCredentials(def, input);
  if (!v.ok) return { ok: false, code: "invalid_input", field: v.field };
  let account: { id?: string; label?: string } = {};
  if (def.test) {
    try {
      const r = await def.test({ conn: { id: "pending", tenantId: actor.tenantId, workspaceId: actor.workspaceId, connectorId: def.id as ConnectionRow["connectorId"], mode: g.mode, status: "not_configured", settings: {}, credentialSecretId: null, webhookSecretId: null, tokenExpiresAt: null }, secrets: v.secrets, http: httpFor(d, def), apiBase: apiBaseFor(def, d.env) });
      account = { id: r.accountId, label: r.accountLabel };
    } catch (e) {
      if (e instanceof CredentialError) return { ok: false, code: "credentials_rejected" };
      throw e;
    }
  }
  const ensured = await ensureConnection(d, def, actor, g.mode);
  if (ensured === "already_connected") return { ok: false, code: "already_connected" };
  return finalize(d, def, ensured.conn, v.secrets, { mode: g.mode, account, uid: actor.uid, reconnect: ensured.existing && ensured.conn.status !== "not_configured" });
}

/** OAuth callback success: tokens come from exchangeCode. */
export async function completeOAuth(d: RuntimeDeps, actor: Actor, connectorId: string, tokens: TokenResult): Promise<LifecycleResult> {
  const def = getConnector(connectorId);
  if (!def || def.auth !== "oauth2") return { ok: false, code: def ? "wrong_auth" : "unknown_connector" };
  const g = await gate(d, def, null);
  if (!g.ok) return g;
  const ensured = await ensureConnection(d, def, actor, g.mode);
  if (ensured === "already_connected") return { ok: false, code: "already_connected" };
  return finalize(d, def, ensured.conn, tokens.secrets, { mode: g.mode, expiresInSec: tokens.expiresInSec, scopes: tokens.scopes, uid: actor.uid, reconnect: ensured.existing && ensured.conn.status !== "not_configured" });
}

/** Re-verifies stored credentials. A rejection flips the connection to needs_attention with a readable reason. */
export async function testConnection(d: RuntimeDeps, connectionId: string): Promise<LifecycleResult<{ healthy: boolean }>> {
  const conn = await d.store.getConnection(connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  const def = getConnector(conn.connectorId);
  if (!def) return { ok: false, code: "unknown_connector" };
  if (!conn.credentialSecretId) return { ok: false, code: "not_found" };
  if (def.auth === "oauth2") {
    const r = await refreshIfNeeded(d, conn);
    if (!r.ok) return { ok: true, value: { healthy: false } };
  }
  const secrets = await loadSecrets(d.vault, (await d.store.getConnection(connectionId)) ?? conn);
  try {
    if (def.test) await def.test({ conn, secrets, http: httpFor(d, def), apiBase: apiBaseFor(def, d.env) });
    await d.store.updateConnection(conn.id, { lastError: null, ...(conn.status === "needs_attention" || conn.status === "error" ? { status: conn.mode === "live" ? "connected" : "sandbox" } : {}) });
    return { ok: true, value: { healthy: true } };
  } catch (e) {
    if (e instanceof CredentialError) {
      await d.store.updateConnection(conn.id, { status: "needs_attention", lastError: safeError(e) });
      return { ok: true, value: { healthy: false } };
    }
    throw e;
  }
}

export async function disconnect(d: RuntimeDeps, connectionId: string, uid: string): Promise<LifecycleResult<{ id: string }>> {
  const conn = await d.store.getConnection(connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  const def = getConnector(conn.connectorId);
  // Audit first: disconnect must not happen unaudited.
  if (!(await audited(d, { action: "connector.disconnected", summary: `Disconnected ${def?.name ?? conn.connectorId}`, connectionId: conn.id, detail: { connector: conn.connectorId, by: uid } }))) return { ok: false, code: "audit_failed" };
  await dropSecrets(d.vault, conn);
  await d.store.updateConnection(conn.id, { status: "disconnected", credentialSecretId: null, webhookSecretId: null, tokenExpiresAt: null, disabledAt: iso(nowOf(d)), lastError: null });
  return { ok: true, value: { id: conn.id } };
}

export type RefreshOutcome = { ok: true; refreshed: boolean } | { ok: false; reason: "needs_attention" | "no_refresh_token" };
/** Refreshes an OAuth token that expires within `skewSec`. Dead refresh token = needs_attention (never silent). Transient errors rethrow. */
export async function refreshIfNeeded(d: RuntimeDeps, conn: ConnectionRow, skewSec = 300): Promise<RefreshOutcome> {
  const def = getConnector(conn.connectorId);
  if (!def || def.auth !== "oauth2" || !def.oauth) return { ok: true, refreshed: false };
  const exp = conn.tokenExpiresAt ? Date.parse(conn.tokenExpiresAt) : NaN;
  if (!Number.isNaN(exp) && exp - nowOf(d).getTime() > skewSec * 1000) return { ok: true, refreshed: false };
  const secrets = await loadSecrets(d.vault, conn);
  const fail = async (msg: string) => { await d.store.updateConnection(conn.id, { status: "needs_attention", lastError: msg }); return { ok: false as const, reason: "needs_attention" as const }; };
  if (!secrets.refresh_token) return fail("The vendor did not give a refresh token; reconnect to continue.");
  try {
    let r: { secrets: ConnectionSecrets; expiresInSec?: number };
    if (def.refresh) r = await def.refresh({ conn, secrets, http: httpFor(d, def) });
    else {
      const clientId = d.env[def.oauth.clientIdEnv] ?? "", clientSecret = d.env[def.oauth.clientSecretEnv] ?? "";
      r = await refreshToken(def.oauth, { refreshToken: secrets.refresh_token, clientId, clientSecret }, d.fetchImpl ?? fetch);
    }
    const id = await saveSecrets(d.vault, conn.id, { ...secrets, ...r.secrets }, conn.credentialSecretId);
    await d.store.updateConnection(conn.id, { credentialSecretId: id, tokenExpiresAt: r.expiresInSec ? iso(new Date(nowOf(d).getTime() + r.expiresInSec * 1000)) : null, lastError: null });
    return { ok: true, refreshed: true };
  } catch (e) {
    if (e instanceof CredentialError) return fail(safeError(e));
    if (e instanceof TransientError) throw e;
    throw e;
  }
}
