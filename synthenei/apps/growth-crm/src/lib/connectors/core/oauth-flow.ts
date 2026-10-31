// Decision logic for the OAuth callback, kept free of Next/Supabase so every rejection path is unit-tested.
import { stateHash, stateMatches, verifyCookie, type OAuthCookie } from "./oauth";

export type CallbackFail = "denied" | "missing_code" | "cookie_missing" | "cookie_invalid" | "expired" | "state_mismatch" | "wrong_connector" | "wrong_user" | "wrong_workspace" | "state_replayed";
export type CallbackCheck = { ok: true; cookie: OAuthCookie; code: string } | { ok: false; reason: CallbackFail };

export interface CallbackInput {
  connector: string; query: { code?: string | null; state?: string | null; error?: string | null };
  cookieToken: string | undefined; secret: string; uid: string; activeWs: string; nowMs?: number;
  /** Deletes the one-time oauth_states row; true when it existed (single use). */
  consumeState(hash: string): Promise<boolean>;
}

export async function checkCallback(i: CallbackInput): Promise<CallbackCheck> {
  if (i.query.error) return { ok: false, reason: "denied" };
  if (!i.query.code || !i.query.state) return { ok: false, reason: "missing_code" };
  if (!i.cookieToken) return { ok: false, reason: "cookie_missing" };
  const v = verifyCookie(i.cookieToken, i.secret, i.nowMs);
  if (!v.ok) return { ok: false, reason: v.reason === "expired" ? "expired" : "cookie_invalid" };
  if (!stateMatches(i.query.state, v.value.state)) return { ok: false, reason: "state_mismatch" };
  if (v.value.connector !== i.connector) return { ok: false, reason: "wrong_connector" };
  if (v.value.uid !== i.uid) return { ok: false, reason: "wrong_user" };
  if (v.value.ws !== i.activeWs) return { ok: false, reason: "wrong_workspace" };
  if (!(await i.consumeState(stateHash(v.value.state)))) return { ok: false, reason: "state_replayed" };
  return { ok: true, cookie: v.value, code: i.query.code };
}
