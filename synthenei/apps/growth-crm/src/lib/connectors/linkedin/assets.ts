// Ad account selection after the OAuth connect. Server-side only: the browser sends an id, never a token; the id is re-checked against
// what the connected user actually manages (LinkedIn's answer, not the request's claim). One ad account belongs to one workspace
// platform-wide. The selection is audited (audit or nothing). Until it runs, no stream does anything.
import type { RuntimeDeps } from "../core/ports";
import { loadSecrets, saveSecrets } from "../core/secrets";
import { CredentialError, type ConnectionSecrets } from "../core/types";
import { gatewayFor } from "./config";
import { CRED, LINKEDIN_CONNECTOR_ID } from "./constants";
import type { AdAccountAsset } from "./gateway";
import type { LinkedInStore } from "./store";

export type AssetFail = "not_found" | "not_connected" | "token_rejected" | "account_not_available" | "account_taken" | "vault_failed" | "audit_failed";
export type AssetResult<T> = { ok: true; value: T } | { ok: false; code: AssetFail };
export interface Actor { uid: string; tenantId: string; workspaceId: string }
export interface Selected { accountName: string; currency: string }

async function connectionOf(d: RuntimeDeps, actor: Actor, id: string) {
  const conn = await d.store.getConnection(id);
  // A connection of another workspace or tenant looks exactly like a missing one.
  if (!conn || conn.connectorId !== LINKEDIN_CONNECTOR_ID || conn.workspaceId !== actor.workspaceId || conn.tenantId !== actor.tenantId) return null;
  return conn;
}
const usable = (s: string) => s !== "disconnected" && s !== "not_configured";

/** The ad accounts the connected user can pick from: names, ids and currency only. */
export async function listLinkedInAccounts(d: RuntimeDeps, actor: Actor, connectionId: string, fetchImpl?: typeof fetch): Promise<AssetResult<AdAccountAsset[]>> {
  const conn = await connectionOf(d, actor, connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId || !usable(conn.status)) return { ok: false, code: "not_connected" };
  try { return { ok: true, value: await gatewayFor({ connectionId: conn.id, secrets: await loadSecrets(d.vault, conn), env: d.env, fetchImpl }).listAdAccounts() }; }
  catch (e) { if (e instanceof CredentialError) return { ok: false, code: "token_rejected" }; throw e; }
}

export async function selectLinkedInAccount(d: RuntimeDeps, li: LinkedInStore, actor: Actor, connectionId: string, accountId: string, fetchImpl?: typeof fetch): Promise<AssetResult<Selected>> {
  const conn = await connectionOf(d, actor, connectionId);
  if (!conn) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId || !usable(conn.status)) return { ok: false, code: "not_connected" };
  const base = await loadSecrets(d.vault, conn);
  try {
    // 1. The id must be one this user manages, as LinkedIn reports it.
    const acct = (await gatewayFor({ connectionId: conn.id, secrets: base, env: d.env, fetchImpl }).listAdAccounts()).find((a) => a.id === accountId);
    if (!acct) return { ok: false, code: "account_not_available" };
    // 2. Platform-wide ownership: refuse before anything is stored.
    const reg = await li.registerAccount({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, connectionId: conn.id, accountId: acct.id, name: acct.name, currency: acct.currency || undefined });
    if (!reg.ok) return { ok: false, code: reg.reason };
    // 3. Secrets: the credential bundle with the chosen account.
    let credId: string;
    try { credId = await saveSecrets(d.vault, conn.id, { ...base, [CRED.adAccountId]: acct.id } as ConnectionSecrets, conn.credentialSecretId); } catch { return { ok: false, code: "vault_failed" }; }
    await d.store.updateConnection(conn.id, { credentialSecretId: credId, externalAccountId: acct.id, externalAccountLabel: acct.name, lastError: null });
    if (d.audit) {
      try { await d.audit({ action: "linkedin.account_selected", summary: "Selected LinkedIn ad account", connectionId: conn.id, detail: { ad_account: acct.id, currency: acct.currency } }); }
      catch { return { ok: false, code: "audit_failed" }; }
    }
    return { ok: true, value: { accountName: acct.name, currency: acct.currency } };
  } catch (e) {
    if (e instanceof CredentialError) return { ok: false, code: "token_rejected" };
    throw e;
  }
}
