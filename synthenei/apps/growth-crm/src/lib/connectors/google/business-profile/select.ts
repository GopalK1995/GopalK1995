// Listing selection after the OAuth connect (target of a server action behind `integrations.manage`). The browser sends account and
// location ids, never a token; the pair must be one the connected Google user manages, as Google reports it. Choosing a different
// listing resets both stream cursors so the new listing never inherits "loaded through" days or a review page token.
import type { RuntimeDeps } from "../../core/ports";
import { loadSecrets } from "../../core/secrets";
import { CredentialError } from "../../core/types";
import { connectionOf, isUsable, saveSelection, type Actor, type SelectResult } from "../shared/select";
import { gbpGatewayFor } from "./config";
import { cleanResourceId, GBP_CONNECTOR_ID, GBP_CRED, RESOURCE_ID, STREAM_PERFORMANCE, STREAM_REVIEWS } from "./constants";
import type { GbpLocation } from "./gateway";

/** Titles, addresses and ids only. */
export async function listGbpLocations(d: RuntimeDeps, actor: Actor, connectionId: string, fetchImpl?: typeof fetch): Promise<SelectResult<GbpLocation[]>> {
  const conn = await connectionOf(d, actor, connectionId, GBP_CONNECTOR_ID);
  if (!conn) return { ok: false, code: "not_found" };
  if (!isUsable(conn)) return { ok: false, code: "not_connected" };
  try { return { ok: true, value: await gbpGatewayFor({ connectionId: conn.id, secrets: await loadSecrets(d.vault, conn), env: d.env, fetchImpl }).listLocations() }; }
  catch (e) { if (e instanceof CredentialError) return { ok: false, code: "token_rejected" }; throw e; }
}

export async function selectGbpLocation(d: RuntimeDeps, actor: Actor, connectionId: string, input: { account: string; location: string }, fetchImpl?: typeof fetch): Promise<SelectResult<{ title: string }>> {
  const conn = await connectionOf(d, actor, connectionId, GBP_CONNECTOR_ID);
  if (!conn) return { ok: false, code: "not_found" };
  if (!isUsable(conn)) return { ok: false, code: "not_connected" };
  const account = cleanResourceId(input.account), location = cleanResourceId(input.location);
  if (!RESOURCE_ID.test(account) || !RESOURCE_ID.test(location)) return { ok: false, code: "invalid_input" };
  let hit: GbpLocation | undefined;
  try { hit = (await gbpGatewayFor({ connectionId: conn.id, secrets: await loadSecrets(d.vault, conn), env: d.env, fetchImpl }).listLocations()).find((l) => l.account === account && l.location === location); }
  catch (e) { if (e instanceof CredentialError) return { ok: false, code: "token_rejected" }; throw e; }
  if (!hit) return { ok: false, code: "not_available" };
  const saved = await saveSelection(d, conn, { [GBP_CRED.account]: hit.account, [GBP_CRED.location]: hit.location }, { id: hit.location, label: hit.title }, [STREAM_REVIEWS, STREAM_PERFORMANCE],
    { action: "google_business.listing_selected", summary: "Selected a Google Business Profile listing", detail: { account: hit.account, location: hit.location } });
  return saved.ok ? { ok: true, value: { title: hit.title } } : saved;
}
