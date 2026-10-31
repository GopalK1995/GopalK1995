// Google Pub/Sub push: Authorization: Bearer <RS256 JWT> signed by Google. We check the signature (Google JWKS), iss, exp and that aud
// equals the configured audience. `secret` is the expected audience, optionally "audience|service-account-email" to pin the sender.
import { createPublicKey, createVerify } from "node:crypto";
import type { Verifier, VerifyOpts } from "./util";

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
let cache: { at: number; keys: Record<string, unknown>[] } | null = null;
async function googleKeys(opts?: VerifyOpts): Promise<Record<string, unknown>[]> {
  if (opts?.fetchKeys) return opts.fetchKeys();
  if (cache && Date.now() - cache.at < 3_600_000) return cache.keys;
  const r = await fetch(JWKS_URL, { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error("jwks");
  const keys = ((await r.json()) as { keys: Record<string, unknown>[] }).keys;
  cache = { at: Date.now(), keys };
  return keys;
}
const b64 = (s: string) => Buffer.from(s, "base64url");

export const verify: Verifier = async (_raw, headers, secret, opts) => {
  try {
    const auth = headers.get("authorization");
    const jwt = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!jwt || !secret) return false;
    const [h, p, s] = jwt.split(".");
    if (!h || !p || !s) return false;
    const header = JSON.parse(b64(h).toString()) as { alg?: string; kid?: string };
    const claims = JSON.parse(b64(p).toString()) as { iss?: string; aud?: string; exp?: number; email?: string; email_verified?: boolean };
    if (header.alg !== "RS256") return false;
    const [aud, email] = secret.split("|");
    const now = (opts?.now ?? Date.now()) / 1000;
    if (!claims.exp || claims.exp < now) return false;
    if (claims.aud !== aud || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss ?? "")) return false;
    if (email && (claims.email !== email || claims.email_verified !== true)) return false;
    const jwk = (await googleKeys(opts)).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    return createVerify("RSA-SHA256").update(`${h}.${p}`).verify(createPublicKey({ key: jwk as never, format: "jwk" }), b64(s));
  } catch { return false; }
};
