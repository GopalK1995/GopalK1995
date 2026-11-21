// Graph change-notification endpoint rules, pure so they are unit-tested and reused by the webhook receiver.
// 1. Handshake: when a subscription is created, Graph POSTs to the notification URL with `?validationToken=<opaque>` and expects the SAME
//    token back as `text/plain`, HTTP 200, within 10 seconds, with no processing. The token is echoed only after it passes a strict shape
//    check (printable, no markup or line breaks, bounded), and only the receiver of a known connection calls this.
// 2. Authenticity: Graph signs nothing; each notification carries the `clientState` we chose at subscribe time. The verifier checks every
//    notification of a delivery against the per-connection secret (constant time); one wrong or missing value rejects the delivery.
import { timingSafeEqual } from "node:crypto";

export interface ValidationAnswer { status: number; text?: string; headers: Record<string, string> }
const NO_STORE = { "cache-control": "no-store" };
const TOKEN = /^[\x20-\x7e]{1,2048}$/;

/** The reply to a `validationToken` request, or null when the request is not a handshake (no parameter). A malformed token gets 400. */
export function answerValidation(token: string | null | undefined): ValidationAnswer | null {
  if (token === null || token === undefined) return null;
  if (!TOKEN.test(token) || /[<>"'&]/.test(token)) return { status: 400, headers: NO_STORE };
  return { status: 200, text: token, headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" } };
}

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a, "utf8"), y = Buffer.from(b, "utf8");
  if (x.length !== y.length) { timingSafeEqual(x, x); return false; }
  return timingSafeEqual(x, y);
};

/** Verifier with the shape of verify/util.ts `Verifier`: (raw body, headers, secret) -> boolean. `secret` is the connection's clientState. */
export function verifyClientState(raw: string, _headers: Headers, secret: string): boolean {
  if (!secret) return false;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return false; }
  const list = j && typeof j === "object" ? (j as { value?: unknown }).value : undefined;
  if (!Array.isArray(list) || !list.length || list.length > 1000) return false;
  return list.every((n) => !!n && typeof n === "object" && typeof (n as { clientState?: unknown }).clientState === "string" && same((n as { clientState: string }).clientState, secret));
}
