// Single-use / bounded-use tokens for the data-subject workflow (AUD-064, PRIV-054, PRIV-023). Pure over a port.
//   verify  the sealed intake link (token.ts). One use. It is never stored when mailed, so it is registered on first use; a second use is a replay.
//   status  read-only link to one request's status. Bounded views, expires.
//   export  delivery link for an access bundle. One download, short life, and the page asks for the verified address again.
// Only sha256(token) is ever stored. Issued tokens (status, export) also carry an HMAC so a forged string is rejected without a lookup.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type TokenPurpose = "verify" | "status" | "export";
export type TokenFailure = "unknown" | "revoked" | "expired" | "used" | "scope" | "unsupported";

export const TOKEN_TTL_MS = { status: 14 * 86_400_000, export: 24 * 3_600_000 } as const;
export const TOKEN_MAX_USES = { verify: 1, status: 30, export: 1 } as const;

export const tokenHash = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

const macKey = (secret: string): Buffer => createHmac("sha256", "privacy-token|v1").update(secret).digest();
const mac = (secret: string, body: string): string => createHmac("sha256", macKey(secret)).update(body).digest("base64url").slice(0, 22);
const LETTER: Record<"status" | "export", string> = { status: "s", export: "e" };

/** p1.<s|e>.<24 random bytes>.<mac>. Throws without a secret: nothing can be issued when the platform is not configured. */
export function issueToken(purpose: "status" | "export", secret: string): { token: string; hash: string } {
  if (!secret) throw new Error("privacy: token secret missing");
  const body = `p1.${LETTER[purpose]}.${randomBytes(24).toString("base64url")}`;
  const token = `${body}.${mac(secret, body)}`;
  return { token, hash: tokenHash(token) };
}

/** Shape and signature check only (no I/O). A token that fails here never reaches the database. */
export function checkIssuedToken(token: string | null | undefined, purpose: "status" | "export", secret: string): boolean {
  if (!token || !secret || token.length > 200) return false;
  const p = token.split(".");
  if (p.length !== 4 || p[0] !== "p1" || p[1] !== LETTER[purpose] || !/^[A-Za-z0-9_-]{32}$/.test(p[2]) || !/^[A-Za-z0-9_-]{22}$/.test(p[3])) return false;
  const want = Buffer.from(mac(secret, `${p[0]}.${p[1]}.${p[2]}`)), got = Buffer.from(p[3]);
  return want.length === got.length && timingSafeEqual(want, got);
}

export interface TokenIssue { purpose: "status" | "export"; wsUuid: string; tenantUuid: string; requestId: string; hash: string; expiresAt: string; maxUses: number; createdBy: string | null }
export type TokenUse = { ok: true; requestId: string | null } | { ok: false; reason: TokenFailure };
export type TokenPeek = { state: "fresh" | "ok" | "used" | "expired" | "revoked" | "scope" | "unsupported"; requestId?: string | null };

export interface TokenPort {
  /** "unsupported" = the ledger does not exist yet (migration 0032 pending): nothing could be issued. */
  issue(i: TokenIssue): Promise<"ok" | "unsupported">;
  /** Atomic: spends one use if the token is live. register=true creates the row on first sight (verify links). */
  use(i: { hash: string; purpose: TokenPurpose; wsUuid: string; expiresAt?: string; register?: boolean }): Promise<TokenUse>;
  /** Never spends. */
  peek(i: { hash: string; purpose: TokenPurpose; wsUuid: string }): Promise<TokenPeek>;
  /** Revokes the unspent tokens of one purpose for a request (a newer delivery link replaces an older one). */
  revoke(i: { requestId: string; purpose: "status" | "export" }): Promise<void>;
}
