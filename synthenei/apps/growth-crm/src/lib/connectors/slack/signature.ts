// Slack request signing (https://api.slack.com/authentication/verifying-requests-from-slack):
//   X-Slack-Signature = "v0=" + hex HMAC-SHA256(signing secret, "v0:" + X-Slack-Request-Timestamp + ":" + raw body), 5 minute window.
// The inbound receiver (T023, verify/slack.ts) applies the same rule at the edge; this module is the connector's own copy with
// reasons, used where the connector verifies a request itself (and by the tests that pin the rule to Slack's published vector).
import { createHmac, timingSafeEqual } from "node:crypto";

export const SLACK_TOLERANCE_SEC = 300;
export type SignatureCheck = { ok: true } | { ok: false; reason: "no_secret" | "missing_headers" | "bad_timestamp" | "stale" | "bad_signature" };

export const slackSignature = (secret: string, timestamp: string, rawBody: string): string =>
  `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`, "utf8").digest("hex")}`;

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a, "utf8"), y = Buffer.from(b, "utf8");
  if (x.length !== y.length) { timingSafeEqual(x, x); return false; }
  return timingSafeEqual(x, y);
};

/** The raw body must be the bytes Slack sent: never re-serialised JSON. */
export function verifySlackRequest(i: { rawBody: string; timestamp: string | null | undefined; signature: string | null | undefined; secret: string | null | undefined; nowMs?: number }): SignatureCheck {
  if (!i.secret) return { ok: false, reason: "no_secret" };
  if (!i.timestamp || !i.signature) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(i.timestamp)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs((i.nowMs ?? Date.now()) - Number(i.timestamp) * 1000) > SLACK_TOLERANCE_SEC * 1000) return { ok: false, reason: "stale" };
  return same(i.signature.toLowerCase(), slackSignature(i.secret, i.timestamp, i.rawBody)) ? { ok: true } : { ok: false, reason: "bad_signature" };
}
