// Server-action target after the OAuth callback: bind the connection to its HubSpot portal (hub id) and store the webhook signing
// secret bundle. Webhook events for any other portal are refused by the handler. Audited.
import { httpFor } from "../core/lifecycle";
import type { RuntimeDeps } from "../core/ports";
import { loadSecrets, saveSecrets } from "../core/secrets";
import { CredentialError } from "../core/types";
import { hubspotConnector } from "./connector";
import { CRED, DEFAULT_API_BASE, HUBSPOT_CONNECTOR_ID, HUBSPOT_ENV, WEBHOOK_KEYS } from "./constants";

export type BindFail = "not_found" | "not_connected" | "token_rejected" | "not_configured" | "vault_failed" | "audit_failed";
export type BindResult = { ok: true; portalId: string } | { ok: false; code: BindFail };

export async function finishHubspotSetup(d: RuntimeDeps, i: { connectionId: string }): Promise<BindResult> {
  const conn = await d.store.getConnection(i.connectionId);
  if (!conn || conn.connectorId !== HUBSPOT_CONNECTOR_ID) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId) return { ok: false, code: "not_connected" };
  const clientSecret = (d.env[HUBSPOT_ENV.clientSecret] ?? "").trim();
  if (!clientSecret) return { ok: false, code: "not_configured" };
  const secrets = await loadSecrets(d.vault, conn);
  const token = secrets[CRED.accessToken];
  if (!token) return { ok: false, code: "not_connected" };
  const base = ((d.env[HUBSPOT_ENV.apiBase] ?? "").trim() || DEFAULT_API_BASE).replace(/\/+$/, "");
  let info: { hub_id?: number | string; hub_domain?: string } | undefined;
  try { info = await httpFor(d, hubspotConnector).json({ method: "GET", url: `${base}/oauth/v1/access-tokens/${encodeURIComponent(token)}` }); }
  catch (e) { if (e instanceof CredentialError) return { ok: false, code: "token_rejected" }; throw e; }
  if (info?.hub_id === undefined) return { ok: false, code: "token_rejected" };
  const portalId = String(info.hub_id);
  if (d.audit) {
    try { await d.audit({ action: "hubspot.portal_bound", summary: "Bound the connection to a HubSpot portal", connectionId: conn.id, detail: { portal: portalId } }); }
    catch { return { ok: false, code: "audit_failed" }; }
  }
  try {
    const credId = await saveSecrets(d.vault, conn.id, { ...secrets, [CRED.hubId]: portalId }, conn.credentialSecretId);
    const hookId = await saveSecrets(d.vault, conn.id, { [WEBHOOK_KEYS.clientSecret]: clientSecret }, conn.webhookSecretId, "webhook");
    await d.store.updateConnection(conn.id, { credentialSecretId: credId, webhookSecretId: hookId, externalAccountId: portalId, externalAccountLabel: info.hub_domain ?? null });
  } catch { return { ok: false, code: "vault_failed" }; }
  return { ok: true, portalId };
}
