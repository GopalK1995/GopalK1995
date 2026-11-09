// Google Ads customer selection after the OAuth connect (target of a server action behind `integrations.manage`). The browser sends a
// customer id, never a token; the id must be a client account the connected Google user can read, as Google reports it. The account
// currency is stored with the selection so the sync converts cost correctly.
import type { RuntimeDeps } from "../../core/ports";
import { loadSecrets } from "../../core/secrets";
import { CredentialError } from "../../core/types";
import { CRED } from "../shared/constants";
import { connectionOf, isUsable, saveSelection, type Actor, type SelectResult } from "../shared/select";
import { adsGatewayFor } from "./config";
import { ADS_CONNECTOR_ID, CUSTOMER_ID, cleanCustomerId, STREAM_DAILY } from "./constants";
import type { AdsCustomer } from "./gateway";

const map = (e: unknown): SelectResult<never> | null => {
  if (!(e instanceof CredentialError)) return null;
  return { ok: false, code: /developer token/i.test(e.message) ? "needs_developer_token" : "token_rejected" };
};

/** Names, ids, currency and the manager link only. */
export async function listAdsCustomers(d: RuntimeDeps, actor: Actor, connectionId: string, fetchImpl?: typeof fetch): Promise<SelectResult<AdsCustomer[]>> {
  const conn = await connectionOf(d, actor, connectionId, ADS_CONNECTOR_ID);
  if (!conn) return { ok: false, code: "not_found" };
  if (!isUsable(conn)) return { ok: false, code: "not_connected" };
  try { return { ok: true, value: await adsGatewayFor({ connectionId: conn.id, secrets: await loadSecrets(d.vault, conn), env: d.env, fetchImpl }).listCustomers() }; }
  catch (e) { const m = map(e); if (m) return m; throw e; }
}

export async function selectAdsCustomer(d: RuntimeDeps, actor: Actor, connectionId: string, customerId: string, fetchImpl?: typeof fetch): Promise<SelectResult<{ name: string; currency: string }>> {
  const conn = await connectionOf(d, actor, connectionId, ADS_CONNECTOR_ID);
  if (!conn) return { ok: false, code: "not_found" };
  if (!isUsable(conn)) return { ok: false, code: "not_connected" };
  const id = cleanCustomerId(customerId);
  if (!CUSTOMER_ID.test(id)) return { ok: false, code: "invalid_input" };
  let hit: AdsCustomer | undefined;
  try { hit = (await adsGatewayFor({ connectionId: conn.id, secrets: await loadSecrets(d.vault, conn), env: d.env, fetchImpl }).listCustomers()).find((c) => c.id === id); }
  catch (e) { const m = map(e); if (m) return m; throw e; }
  if (!hit) return { ok: false, code: "not_available" };
  if (!hit.currency) return { ok: false, code: "invalid_input" };
  const saved = await saveSelection(d, conn, { [CRED.customerId]: hit.id, [CRED.loginCustomerId]: hit.loginCustomerId, [CRED.currency]: hit.currency }, { id: hit.id, label: hit.name }, [STREAM_DAILY],
    { action: "google_ads.customer_selected", summary: "Selected a Google Ads account", detail: { customer: hit.id, currency: hit.currency, via_manager: !!hit.loginCustomerId } });
  return saved.ok ? { ok: true, value: { name: hit.name, currency: hit.currency } } : saved;
}
