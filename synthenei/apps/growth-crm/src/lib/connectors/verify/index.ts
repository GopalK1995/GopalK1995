// Scheme registry for inbound webhooks: which verifier a connector uses, which secret key it needs, and its dedupe id.
import { createHash } from "node:crypto";
import { verify as calcom } from "./calcom";
import { verify as calendly } from "./calendly";
import { verify as googlePubsub } from "./google-pubsub";
import { verify as hubspot } from "./hubspot";
import { verify as mailchimp } from "./mailchimp";
import { verify as meta } from "./meta";
import { verify as razorpay } from "./razorpay";
import { verify as slack } from "./slack";
import { verify as standard } from "./standard";
import { verify as zoho } from "./zoho";
import type { Verifier } from "./util";

export type Scheme = "meta" | "razorpay" | "slack" | "calendly" | "calcom" | "google-pubsub" | "mailchimp" | "hubspot" | "zoho" | "standard";
export const VERIFIERS: Record<Scheme, Verifier> = { meta, razorpay, slack, calendly, calcom, "google-pubsub": googlePubsub, mailchimp, hubspot, zoho, standard };

const SCHEME_OF: Record<string, Scheme> = {
  whatsapp: "meta", "meta-ads": "meta", razorpay: "razorpay", slack: "slack", calendly: "calendly", "cal-com": "calcom",
  gmail: "google-pubsub", "google-calendar": "google-pubsub", mailchimp: "mailchimp", hubspot: "hubspot", "zoho-crm": "zoho",
  zapier: "standard", make: "standard", mock: "standard",
};
/** The verification scheme a connector declares, or undefined when it does not receive webhooks (receiver answers 404). */
export const schemeFor = (connectorId: string): Scheme | undefined => SCHEME_OF[connectorId];

const SECRET_KEYS = ["webhook_secret", "signing_secret", "signing_key", "app_secret", "client_secret", "secret", "audience"];
/** Picks the signing secret from a Vault bundle: JSON object with one of the known keys, or the raw string itself. */
export function pickSecret(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      for (const k of SECRET_KEYS) if (typeof o[k] === "string" && o[k]) return o[k] as string;
      return null;
    }
  } catch { /* not JSON: a plain secret */ }
  return raw;
}
/** The Meta hub.challenge verify token from a Vault bundle (`verify_token`). */
export function pickVerifyToken(raw: string | null): string | null {
  if (!raw) return null;
  try { const v = JSON.parse(raw) as Record<string, unknown>; return typeof v.verify_token === "string" ? v.verify_token : null; } catch { return null; }
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** Provider event id used for dedupe (before the connection prefix): the vendor's own id when it sends one, else a body hash. */
export function providerEventId(scheme: Scheme, headers: Headers, raw: string): string {
  const h = scheme === "razorpay" ? headers.get("x-razorpay-event-id") : scheme === "standard" ? headers.get("webhook-id") : null;
  if (h && h.length <= 200) return h;
  try {
    const j = JSON.parse(raw) as { event_id?: unknown; message?: { messageId?: unknown } };
    if (scheme === "slack" && typeof j.event_id === "string") return j.event_id;
    if (scheme === "google-pubsub" && typeof j.message?.messageId === "string") return j.message.messageId;
  } catch { /* hash below */ }
  return `sha256:${sha(raw)}`;
}

/** Headers kept in webhook_inbox.headers: allow-listed, never signatures or authorization. */
const KEEP = ["content-type", "user-agent", "x-razorpay-event-id", "webhook-id", "webhook-timestamp", "x-slack-request-timestamp"];
export function allowListedHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEEP) { const v = h.get(k); if (v) out[k] = v.slice(0, 200); }
  return out;
}
