// Server-action target after the OAuth callback: choose the data centre (region) and confirm the token against that centre's API.
// The OAuth routes use the deployment's default accounts server; a tenant on another data centre sets its region here. Audited.
import { httpFor } from "../core/lifecycle";
import type { RuntimeDeps } from "../core/ports";
import { loadSecrets, saveSecrets } from "../core/secrets";
import { CredentialError } from "../core/types";
import { zohoConnector } from "./connector";
import { REGIONS, CRED, ZOHO_CONNECTOR_ID, ZOHO_ENV, isRegion } from "./constants";
import { apiBaseOf } from "./config";

export type SetupFail = "not_found" | "not_connected" | "invalid_region" | "token_rejected" | "vault_failed" | "audit_failed";
export type SetupResult = { ok: true; region: string; orgLabel?: string } | { ok: false; code: SetupFail };

export async function finishZohoSetup(d: RuntimeDeps, i: { connectionId: string; region: string }): Promise<SetupResult> {
  if (!isRegion(i.region)) return { ok: false, code: "invalid_region" };
  const conn = await d.store.getConnection(i.connectionId);
  if (!conn || conn.connectorId !== ZOHO_CONNECTOR_ID) return { ok: false, code: "not_found" };
  if (!conn.credentialSecretId) return { ok: false, code: "not_connected" };
  const secrets = await loadSecrets(d.vault, conn);
  const next = { ...secrets, [CRED.region]: i.region };
  let org: { id?: string; company_name?: string } | undefined;
  try {
    const base = (d.env[ZOHO_ENV.apiBase] ?? "").trim() ? apiBaseOf(next, d.env) : REGIONS[i.region].api;
    const res = await httpFor(d, zohoConnector).json<{ org?: { id?: string; company_name?: string }[] } | undefined>({ method: "GET", url: `${base.replace(/\/+$/, "")}/crm/v6/org`, headers: { authorization: `Zoho-oauthtoken ${secrets[CRED.accessToken] ?? ""}` } });
    org = res?.org?.[0];
  } catch (e) {
    if (e instanceof CredentialError) return { ok: false, code: "token_rejected" };
    throw e;
  }
  if (d.audit) {
    try { await d.audit({ action: "zoho.region_set", summary: `Set Zoho data centre to ${i.region}`, connectionId: conn.id, detail: { region: i.region } }); }
    catch { return { ok: false, code: "audit_failed" }; }
  }
  let id: string;
  try { id = await saveSecrets(d.vault, conn.id, org?.id ? { ...next, [CRED.orgId]: String(org.id) } : next, conn.credentialSecretId); } catch { return { ok: false, code: "vault_failed" }; }
  await d.store.updateConnection(conn.id, { credentialSecretId: id, externalAccountId: org?.id ? String(org.id) : null, externalAccountLabel: org?.company_name ?? null });
  return { ok: true, region: i.region, orgLabel: org?.company_name };
}
