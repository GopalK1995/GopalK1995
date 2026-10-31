// Short-lived HS256 JWT for an API key's bot user, so RLS applies to API traffic exactly as to the UI (BUILD-PLAN 1.9).
// Works only while the project still accepts tokens signed with the legacy JWT secret; see docs/tasks/T025.md for the
// RPC fallback when the project has moved to asymmetric signing keys only.
import { createHmac, timingSafeEqual } from "node:crypto";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
export const BOT_JWT_TTL_SEC = 300;

export interface MintInput { sub: string; secret: string; keyId: string; issuer?: string; ttlSec?: number; now?: number }

export function mintBotJwt(i: MintInput): { token: string; expiresAt: number } {
  const iat = Math.floor((i.now ?? Date.now()) / 1000), exp = iat + (i.ttlSec ?? BOT_JWT_TTL_SEC);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    aud: "authenticated", role: "authenticated", sub: i.sub, iat, exp, ...(i.issuer ? { iss: i.issuer } : {}),
    app_metadata: { provider: "api_key", api_key_id: i.keyId }, user_metadata: {},
  });
  const sig = createHmac("sha256", i.secret).update(`${head}.${body}`).digest("base64url");
  return { token: `${head}.${body}.${sig}`, expiresAt: exp };
}

/** Self-check and test helper: verifies signature and expiry, returns the claims or null. */
export function verifyBotJwt(token: string, secret: string, now = Date.now()): Record<string, unknown> | null {
  const [h, b, s] = token.split(".");
  if (!h || !b || !s) return null;
  const want = createHmac("sha256", secret).update(`${h}.${b}`).digest();
  const got = Buffer.from(s, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const claims = JSON.parse(Buffer.from(b, "base64url").toString("utf8")) as Record<string, unknown>;
  return typeof claims.exp === "number" && claims.exp * 1000 > now ? claims : null;
}
