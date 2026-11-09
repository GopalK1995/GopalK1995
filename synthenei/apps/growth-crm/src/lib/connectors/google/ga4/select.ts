// GA4 property selection after the OAuth connect (target of a server action behind `integrations.manage`). The browser sends a property
// id, never a token; the id must be one the connected Google user can read, as Google reports it.
import type { RuntimeDeps } from "../../core/ports";
import { loadSecrets } from "../../core/secrets";
import { CredentialError } from "../../core/types";
import { CRED } from "../shared/constants";
import { connectionOf, isUsable, saveSelection, type Actor, type SelectResult } from "../shared/select";
import { GA4_CONNECTOR_ID, STREAM_DAILY } from "./constants";
import { ga4GatewayFor } from "./config";
import type { Ga4Property } from "./gateway";

/** Names and ids only. */
export async function listGa4Properties(d: RuntimeDeps, actor: Actor, connectionId: string, fetchImpl?: typeof fetch): Promise<SelectResult<Ga4Property[]>> {
  const conn = await connectionOf(d, actor, connectionId, GA4_CONNECTOR_ID);
  if (!conn) return { ok: false, code: "not_found" };
  if (!isUsable(conn)) return { ok: false, code: "not_connected" };
  try { return { ok: true, value: await ga4GatewayFor({ secrets: await loadSecrets(d.vault, conn), env: d.env, fetchImpl }).listProperties() }; }
  catch (e) { if (e instanceof CredentialError) return { ok: false, code: "token_rejected" }; throw e; }
}

export async function selectGa4Property(d: RuntimeDeps, actor: Actor, connectionId: string, propertyId: string, fetchImpl?: typeof fetch): Promise<SelectResult<{ name: string }>> {
  const conn = await connectionOf(d, actor, connectionId, GA4_CONNECTOR_ID);
  if (!conn) return { ok: false, code: "not_found" };
  if (!isUsable(conn)) return { ok: false, code: "not_connected" };
  if (!/^\d{1,20}$/.test(propertyId)) return { ok: false, code: "invalid_input" };
  let name: string;
  try {
    const hit = (await ga4GatewayFor({ secrets: await loadSecrets(d.vault, conn), env: d.env, fetchImpl }).listProperties()).find((p) => p.id === propertyId);
    if (!hit) return { ok: false, code: "not_available" };
    name = hit.name;
  } catch (e) { if (e instanceof CredentialError) return { ok: false, code: "token_rejected" }; throw e; }
  const saved = await saveSelection(d, conn, { [CRED.propertyId]: propertyId }, { id: propertyId, label: name }, [STREAM_DAILY], { action: "ga4.property_selected", summary: "Selected a GA4 property", detail: { property: propertyId } });
  return saved.ok ? { ok: true, value: { name } } : saved;
}
