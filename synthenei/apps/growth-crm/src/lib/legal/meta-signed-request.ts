// Verifies Meta's signed_request (data-deletion callback): "<base64url signature>.<base64url JSON payload>", signature = HMAC-SHA256 of the
// payload part exactly as received, keyed with the app secret. Pure and synchronous; no network. Never logs the secret or the payload.
import { createHmac, timingSafeEqual } from "node:crypto";

export type SignedRequestResult =
  | { ok: true; userId: string; payload: Record<string, unknown> }
  | { ok: false; reason: "malformed" | "bad_signature" | "bad_payload" | "bad_algorithm" | "no_user_id" | "no_secret" };

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Strict base64url decode (RFC 4648 section 5). Trailing "=" padding is tolerated; standard-alphabet "+" and "/" are rejected. */
export function b64urlDecode(s: string): Buffer | null {
  const t = s.replace(/={0,2}$/, "");
  if (t.length === 0 || !B64URL.test(t) || t.length % 4 === 1) return null;
  return Buffer.from(t, "base64url");
}

export function b64urlEncode(b: Buffer | string): string { return Buffer.from(b).toString("base64url"); }

/** Test and tooling helper: builds a valid signed_request. */
export function signRequest(payload: Record<string, unknown>, secret: string): string {
  const body = b64urlEncode(JSON.stringify(payload));
  return `${b64urlEncode(createHmac("sha256", secret).update(body).digest())}.${body}`;
}

export function verifySignedRequest(signedRequest: unknown, secret: string | undefined | null): SignedRequestResult {
  if (!secret) return { ok: false, reason: "no_secret" };
  if (typeof signedRequest !== "string" || signedRequest.length === 0 || signedRequest.length > 8192) return { ok: false, reason: "malformed" };
  const parts = signedRequest.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const [sigPart, bodyPart] = parts;
  const sig = b64urlDecode(sigPart);
  if (!sig) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", secret).update(bodyPart.replace(/={0,2}$/, "")).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return { ok: false, reason: "bad_signature" };
  const raw = b64urlDecode(bodyPart);
  if (!raw) return { ok: false, reason: "bad_payload" };
  let payload: unknown;
  try { payload = JSON.parse(raw.toString("utf8")); } catch { return { ok: false, reason: "bad_payload" }; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "bad_payload" };
  const p = payload as Record<string, unknown>;
  if (typeof p.algorithm !== "string" || p.algorithm.toUpperCase() !== "HMAC-SHA256") return { ok: false, reason: "bad_algorithm" };
  const id = typeof p.user_id === "number" && Number.isSafeInteger(p.user_id) ? String(p.user_id) : p.user_id;
  if (typeof id !== "string" || !/^\d{1,32}$/.test(id)) return { ok: false, reason: "no_user_id" };
  return { ok: true, userId: id, payload: p };
}
