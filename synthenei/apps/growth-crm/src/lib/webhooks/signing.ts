// Standard Webhooks signing (https://www.standardwebhooks.com). Secret format `whsec_<base64>`; the HMAC key is the decoded bytes.
// signature = "v1," + base64(HMAC_SHA256(key, `${id}.${timestamp}.${body}`)). Several signatures go in one header, space separated
// (used during secret rotation so receivers can verify with either secret).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SECRET_PREFIX = "whsec_";

export function generateSecret(): string {
  return SECRET_PREFIX + randomBytes(24).toString("base64");
}

export function secretKey(secret: string): Buffer {
  if (!secret.startsWith(SECRET_PREFIX)) throw new Error("signing secret must start with whsec_");
  return Buffer.from(secret.slice(SECRET_PREFIX.length), "base64");
}

export function signV1(secret: string, id: string, timestamp: number | string, body: string): string {
  return "v1," + createHmac("sha256", secretKey(secret)).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export type SignedHeaders = { "webhook-id": string; "webhook-timestamp": string; "webhook-signature": string; "content-type": string; "user-agent": string };

/** Headers for one delivery. `secrets` is [current] or [current, previous] inside the rotation grace window. */
export function signedHeaders(secrets: string[], id: string, timestampSeconds: number, body: string): SignedHeaders {
  if (secrets.length === 0) throw new Error("no signing secret");
  return {
    "content-type": "application/json",
    "user-agent": "SynthanCRM-Webhooks/1",
    "webhook-id": id,
    "webhook-timestamp": String(timestampSeconds),
    "webhook-signature": secrets.map((s) => signV1(s, id, timestampSeconds, body)).join(" "),
  };
}

/** Receiver-side check, used by tests and the test-ping docs. Rejects timestamps further than `toleranceSeconds` from now. */
export function verifySignature(secret: string, headers: Record<string, string>, body: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  const id = headers["webhook-id"], ts = headers["webhook-timestamp"], sig = headers["webhook-signature"];
  if (!id || !ts || !sig) return false;
  if (!/^\d+$/.test(ts) || Math.abs(nowSeconds - Number(ts)) > toleranceSeconds) return false;
  const expected = Buffer.from(signV1(secret, id, ts, body));
  return sig.split(" ").some((part) => {
    const got = Buffer.from(part);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

/** `whsec_abcd…wxyz` for display; never enough to sign. */
export const maskSecret = (_secret?: string) => `${SECRET_PREFIX}••••••••`;
