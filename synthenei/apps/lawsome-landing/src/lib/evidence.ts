// Consent evidence for the demo-request form (AUD-063, PRIV-013). Server only (node:crypto). Mirrors apps/growth-crm/src/lib/privacy/evidence.ts:
// the same coarse user-agent classes, and an HMAC of the client address so the CRM can show that two consents came from one source without
// ever holding the address. The key is LEAD_EVIDENCE_SECRET (this app's environment, never the database). Unset = no hash is sent.
import { createHmac } from "node:crypto";

export type UaClass = "mobile" | "desktop" | "tablet" | "bot" | "unknown";

export function uaClass(ua: string | null | undefined): UaClass {
  const s = (ua ?? "").slice(0, 400).toLowerCase();
  if (!s.trim()) return "unknown";
  if (/bot|crawler|spider|slurp|curl\/|wget\/|python-requests|headless|preview|facebookexternalhit/.test(s)) return "bot";
  if (/ipad|tablet|kindle|silk\/|playbook/.test(s) || (/android/.test(s) && !/mobile/.test(s))) return "tablet";
  if (/mobi|iphone|ipod|android|windows phone/.test(s)) return "mobile";
  if (/windows nt|macintosh|x11|cros|linux/.test(s)) return "desktop";
  return "unknown";
}

/** First address of x-forwarded-for, else x-real-ip. Empty when neither is present. */
export function clientIp(h: { get(name: string): string | null }): string {
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim().slice(0, 64);
}

/** HMAC-SHA256 hex (64 chars). Null without an address or a secret: absence is recorded as absence. */
export function ipHash(ip: string, secret: string): string | null {
  const v = ip.trim().toLowerCase();
  if (!v || !secret) return null;
  const key = createHmac("sha256", "consent-ip|v1").update(secret).digest();
  return createHmac("sha256", key).update(v).digest("hex");
}

/** Which form wording the person saw. Bump the suffix when the checkbox text or the set of boxes changes. */
export const FORM_ID = "lawsome-landing/demo-form@v2";
