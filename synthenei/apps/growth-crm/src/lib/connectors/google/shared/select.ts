// Asset selection plumbing shared by the three connectors (GA4 property, Ads customer, Sheets). Server-side only: the browser sends ids,
// never tokens; ids are re-checked against what the connected Google user can reach (Google's answer, not the request's claim).
import type { RuntimeDeps } from "../../core/ports";
import { loadSecrets, saveSecrets } from "../../core/secrets";
import type { ConnectionRow, ConnectionSecrets, ConnectorId } from "../../core/types";

export type SelectFail = "not_found" | "not_connected" | "not_configured" | "token_rejected" | "not_available" | "needs_developer_token" | "invalid_input" | "vault_failed" | "audit_failed";
export type SelectResult<T> = { ok: true; value: T } | { ok: false; code: SelectFail };
export interface Actor { uid: string; tenantId: string; workspaceId: string }

const usable = (s: string) => s !== "disconnected" && s !== "not_configured";

/** A connection of another workspace or tenant looks exactly like a missing one. */
export async function connectionOf(d: RuntimeDeps, actor: Actor, id: string, connectorId: ConnectorId): Promise<ConnectionRow | null> {
  const conn = await d.store.getConnection(id);
  if (!conn || conn.connectorId !== connectorId || conn.workspaceId !== actor.workspaceId || conn.tenantId !== actor.tenantId) return null;
  return conn;
}
export const isUsable = (conn: ConnectionRow): boolean => !!conn.credentialSecretId && usable(conn.status);

/**
 * Stores the chosen ids in the credential bundle (Vault), records the account on the connection, resets the stream cursors (a different
 * account must not inherit "loaded through" days) and audits. Audit or nothing: an audit failure is reported.
 */
export async function saveSelection(d: RuntimeDeps, conn: ConnectionRow, patch: Record<string, string | undefined>, account: { id: string; label: string }, streams: string[], audit: { action: string; summary: string; detail: Record<string, unknown> }): Promise<SelectResult<true>> {
  const base = await loadSecrets(d.vault, conn);
  const bundle: ConnectionSecrets = { ...base };
  for (const [k, v] of Object.entries(patch)) { if (v) bundle[k] = v; else delete bundle[k]; }
  let credId: string;
  try { credId = await saveSecrets(d.vault, conn.id, bundle, conn.credentialSecretId); } catch { return { ok: false, code: "vault_failed" }; }
  await d.store.updateConnection(conn.id, { credentialSecretId: credId, externalAccountId: account.id, externalAccountLabel: account.label, lastError: null });
  for (const s of streams) await d.store.setCursor(conn.id, s, null);
  if (d.audit) {
    try { await d.audit({ action: audit.action, summary: audit.summary, connectionId: conn.id, detail: audit.detail }); }
    catch { return { ok: false, code: "audit_failed" }; }
  }
  return { ok: true, value: true };
}
