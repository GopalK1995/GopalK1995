// API key format, hashing and constant-time comparison (CONTRACTS C11).
// Format: sk_<live|test>_<8-char prefix>_<32-char base62 secret>. Only the prefix and sha256(full key) are stored.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type KeyEnv = "live" | "test";
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEY_RE = /^sk_(live|test)_([0-9A-Za-z]{8})_([0-9A-Za-z]{32})$/;

export interface ParsedKey { env: KeyEnv; prefix: string; secret: string }
export interface GeneratedKey { key: string; env: KeyEnv; prefix: string; hash: string }

/** Uniform base62 string (rejection sampling, no modulo bias). */
export function randomBase62(len: number, rnd: (n: number) => Uint8Array = (n) => randomBytes(n)): string {
  let out = "";
  while (out.length < len) {
    for (const b of rnd(len * 2)) {
      if (b < 248 && out.length < len) out += B62[b % 62];
    }
  }
  return out;
}

export const hashKey = (key: string): string => createHash("sha256").update(key, "utf8").digest("hex");

export function generateKey(env: KeyEnv, rnd?: (n: number) => Uint8Array): GeneratedKey {
  const prefix = randomBase62(8, rnd), secret = randomBase62(32, rnd);
  const key = `sk_${env}_${prefix}_${secret}`;
  return { key, env, prefix, hash: hashKey(key) };
}

export function parseKey(raw: string | null | undefined): ParsedKey | null {
  const m = typeof raw === "string" ? KEY_RE.exec(raw.trim()) : null;
  return m ? { env: m[1] as KeyEnv, prefix: m[2], secret: m[3] } : null;
}

/** `Authorization: Bearer <key>` (scheme case-insensitive). */
export function bearerToken(header: string | null | undefined): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  return m ? m[1] : null;
}

const ZERO = "0".repeat(64);
/** Constant-time check of a presented key against the stored hex hash. Always compares 32 bytes, so a malformed hash costs the same. */
export function verifyKey(presentedKey: string, storedHashHex: string | null | undefined): boolean {
  const a = Buffer.from(hashKey(presentedKey), "hex");
  const stored = typeof storedHashHex === "string" && /^[0-9a-f]{64}$/i.test(storedHashHex) ? storedHashHex : ZERO;
  const ok = timingSafeEqual(a, Buffer.from(stored, "hex"));
  return ok && stored !== ZERO;
}

/** What a UI may show of a key: never the secret part. */
export const maskedKey = (env: KeyEnv, prefix: string): string => `sk_${env}_${prefix}_${"*".repeat(8)}`;
