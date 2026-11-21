// Per-user Google grants inside one workspace connection. The framework keeps one connection per workspace and connector, so each
// user's own OAuth grant lives in that connection's Vault bundle: the first (or reconnecting) user at the top level (`access_token`,
// `refresh_token`, `primary_uid`, which keeps the core refresh / test paths working) and every other user under `grant:<uid>` as JSON.
// Nobody's tokens are ever returned to a client or logged. A dead grant is marked, never silently reused.
import { loadSecrets, saveSecrets } from "../../core/secrets";
import type { RuntimeDeps } from "../../core/ports";
import { completeOAuth, type Actor, type LifecycleResult } from "../../core/lifecycle";
import type { TokenResult } from "../../core/oauth";
import { CredentialError, TransientError, type ConnectionSecrets } from "../../core/types";
import { CRED } from "../shared/constants";
import { refreshGoogleToken } from "../shared/token";

type Env = Record<string, string | undefined>;
export const GRANT_PREFIX = "grant:";
export const PRIMARY_UID = "primary_uid";
export const PRIMARY_EMAIL = "primary_email";
const SKEW_SEC = 300;

export interface Grant { uid: string; access: string; refresh: string; email?: string; dead: boolean; primary: boolean }
interface Stored { a?: string; r?: string; e?: string; x?: number; dead?: boolean }

export function grantsOf(s: ConnectionSecrets): Grant[] {
  const out: Grant[] = [];
  const pu = s[PRIMARY_UID];
  if (pu && s[CRED.refreshToken]) out.push({ uid: pu, access: s[CRED.accessToken] ?? "", refresh: s[CRED.refreshToken], email: s[PRIMARY_EMAIL], dead: s.primary_dead === "1", primary: true });
  for (const [k, v] of Object.entries(s)) {
    if (!k.startsWith(GRANT_PREFIX)) continue;
    let g: Stored;
    try { g = JSON.parse(v) as Stored; } catch { continue; }
    if (g.r) out.push({ uid: k.slice(GRANT_PREFIX.length), access: g.a ?? "", refresh: g.r, email: g.e, dead: !!g.dead, primary: false });
  }
  return out;
}
export const liveGrants = (s: ConnectionSecrets): Grant[] => grantsOf(s).filter((g) => !g.dead && g.access);

/** The acting user's own grant when they have one, else the primary grant. */
export function grantFor(s: ConnectionSecrets, uid?: string): Grant | undefined {
  const live = liveGrants(s);
  return live.find((g) => g.uid === uid) ?? live.find((g) => g.primary) ?? live[0];
}

const put = (s: ConnectionSecrets, uid: string, g: Stored): void => { s[GRANT_PREFIX + uid] = JSON.stringify(g); };

/**
 * Refresh for the core lifecycle (`ConnectorDef.refresh`). The primary grant is refreshed through the shared helper: a dead one throws a
 * CredentialError, so the framework flips the connection to needs_attention. Other users' grants are refreshed when due; a dead one is
 * marked and skipped, a transient failure leaves it for the next run.
 */
export async function refreshAllGrants(i: { secrets: ConnectionSecrets; env: Env; fetchImpl?: typeof fetch; nowMs?: number }): Promise<{ secrets: ConnectionSecrets; expiresInSec?: number }> {
  const primary = await refreshGoogleToken({ secrets: i.secrets, env: i.env, fetchImpl: i.fetchImpl });
  const out: ConnectionSecrets = { ...i.secrets, ...primary.secrets };
  const now = i.nowMs ?? Date.now();
  for (const g of grantsOf(i.secrets)) {
    if (g.primary || g.dead) continue;
    const stored = JSON.parse(i.secrets[GRANT_PREFIX + g.uid]) as Stored;
    if (stored.x && stored.x - now > SKEW_SEC * 1000) continue;
    try {
      const r = await refreshGoogleToken({ secrets: { [CRED.refreshToken]: g.refresh }, env: i.env, fetchImpl: i.fetchImpl });
      put(out, g.uid, { ...stored, a: r.secrets[CRED.accessToken], r: r.secrets[CRED.refreshToken], x: r.expiresInSec ? now + r.expiresInSec * 1000 : undefined, dead: false });
    } catch (e) {
      if (e instanceof CredentialError) put(out, g.uid, { ...stored, dead: true });
      else if (!(e instanceof TransientError)) throw e;
    }
  }
  return { secrets: out, expiresInSec: primary.expiresInSec };
}

export const countLive = (s: ConnectionSecrets): number => liveGrants(s).length;
/** For the UI: who is connected and who has to reconnect. No tokens. */
export const grantSummary = (s: ConnectionSecrets): { uid: string; email?: string; status: "ok" | "needs_reconnect"; primary: boolean }[] =>
  grantsOf(s).map((g) => ({ uid: g.uid, email: g.email, status: g.dead || !g.access ? "needs_reconnect" : "ok", primary: g.primary }));

/**
 * OAuth callback target for a per-user connect. The first user (or the one reconnecting after the primary grant died) goes through the
 * core `completeOAuth`; any other user is added as an extra grant to the live connection. Other users' grants survive a reconnect.
 * `extra` carries small non-secret flags (for example the Gmail opt-in stamp) and the user's mailbox / calendar address.
 */
export async function connectGoogleUser(d: RuntimeDeps, actor: Actor, connectorId: string, tokens: TokenResult, extra: { email?: string; flags?: Record<string, string> } = {}): Promise<LifecycleResult> {
  const found = await d.store.findConnection(actor.workspaceId, connectorId);
  if (found && (found.tenantId !== actor.tenantId)) return { ok: false, code: "not_found" };
  const usable = !!found && !!found.credentialSecretId && (found.status === "connected" || found.status === "sandbox");
  const prior = found?.credentialSecretId ? await loadSecrets(d.vault, found) : {};
  const refresh = tokens.secrets[CRED.refreshToken];
  if (!refresh) return { ok: false, code: "credentials_rejected" };
  const now = (d.now ? d.now() : new Date()).getTime();
  const exp = tokens.expiresInSec ? now + tokens.expiresInSec * 1000 : undefined;

  if (usable && found) {
    const bundle: ConnectionSecrets = { ...prior, ...(extra.flags ?? {}) };
    if (prior[PRIMARY_UID] === actor.uid) { bundle[CRED.accessToken] = tokens.secrets[CRED.accessToken]; bundle[CRED.refreshToken] = refresh; delete bundle.primary_dead; if (extra.email) bundle[PRIMARY_EMAIL] = extra.email; }
    else put(bundle, actor.uid, { a: tokens.secrets[CRED.accessToken], r: refresh, e: extra.email, x: exp });
    let id: string;
    try { id = await saveSecrets(d.vault, found.id, bundle, found.credentialSecretId); } catch { return { ok: false, code: "vault_failed" }; }
    await d.store.updateConnection(found.id, { credentialSecretId: id, lastError: null });
    if (d.audit) { try { await d.audit({ action: "google.user_connected", summary: "A user connected their Google account", connectionId: found.id, detail: { connector: connectorId, user: actor.uid } }); } catch { return { ok: false, code: "audit_failed" }; } }
    return { ok: true, value: { ...found, credentialSecretId: id } };
  }

  // First connect, or reconnect of a connection that needs attention: keep the other users' grants, demote a dead primary to an extra.
  const kept: ConnectionSecrets = {};
  for (const [k, v] of Object.entries(prior)) if (k.startsWith(GRANT_PREFIX) && k !== GRANT_PREFIX + actor.uid) kept[k] = v;
  const oldPrimary = prior[PRIMARY_UID];
  if (oldPrimary && oldPrimary !== actor.uid && prior[CRED.refreshToken]) put(kept, oldPrimary, { a: prior[CRED.accessToken], r: prior[CRED.refreshToken], e: prior[PRIMARY_EMAIL], dead: true });
  const r = await completeOAuth(d, actor, connectorId, tokens);
  if (!r.ok) return r;
  const bundle: ConnectionSecrets = { ...kept, ...tokens.secrets, [PRIMARY_UID]: actor.uid, ...(extra.email ? { [PRIMARY_EMAIL]: extra.email } : {}), ...(extra.flags ?? {}) };
  let id: string;
  try { id = await saveSecrets(d.vault, r.value.id, bundle, r.value.credentialSecretId); } catch { return { ok: false, code: "vault_failed" }; }
  await d.store.updateConnection(r.value.id, { credentialSecretId: id });
  return { ok: true, value: { ...r.value, credentialSecretId: id } };
}
