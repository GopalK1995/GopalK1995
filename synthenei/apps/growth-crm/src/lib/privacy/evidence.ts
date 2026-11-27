// Consent evidence (AUD-063, PRIV-013): what a consent_log row must be able to prove later. Pure helpers, no I/O.
//   - the notice the person was shown, as a hash of its canonical text (the text itself lives in notice_versions)
//   - the form that collected it (a short stable id, never a URL with a query string)
//   - an HMAC of the client address (never the address), made with a key that is not in the database
//   - a coarse user-agent class (never the raw string)
// Everything here is optional on purpose: the columns arrive with migration 0032 and the app works without it.
import { createHash, createHmac } from "node:crypto";
import { buildNotice } from "./notice";
import type { PrT } from "./strings";
import type { PublicWorkspace } from "./types";

export const UA_CLASSES = ["mobile", "desktop", "tablet", "bot", "unknown"] as const;
export type UaClass = (typeof UA_CLASSES)[number];

/** Coarse class of a User-Agent header. Order matters: bots first, then tablets, then phones. */
export function uaClass(ua: string | null | undefined): UaClass {
  const s = (ua ?? "").slice(0, 400).toLowerCase();
  if (!s.trim()) return "unknown";
  if (/bot|crawler|spider|slurp|curl\/|wget\/|python-requests|headless|preview|facebookexternalhit/.test(s)) return "bot";
  if (/ipad|tablet|kindle|silk\/|playbook/.test(s) || (/android/.test(s) && !/mobile/.test(s))) return "tablet";
  if (/mobi|iphone|ipod|android|windows phone/.test(s)) return "mobile";
  if (/windows nt|macintosh|x11|cros|linux/.test(s)) return "desktop";
  return "unknown";
}

const IP_KEY_DOMAIN = "consent-ip|v1";
/**
 * HMAC-SHA256 (hex, 64 chars) of a client address with a key derived from a server-side secret. Null when there is no usable address or
 * no secret: absence is recorded as absence, never as a hash of an empty string. The same address always gives the same value for one
 * secret, so two rows can be shown to come from one source without revealing it.
 */
export function ipHash(ip: string | null | undefined, secret: string): string | null {
  const v = (ip ?? "").trim().toLowerCase();
  if (!v || v === "unknown" || !secret) return null;
  const key = createHmac("sha256", IP_KEY_DOMAIN).update(secret).digest();
  return createHmac("sha256", key).update(v).digest("hex");
}

export const FORM_ID_RE = /^[A-Za-z0-9_./@:-]{1,80}$/;
export const cleanFormId = (v: string | null | undefined): string | null => (v && FORM_ID_RE.test(v) ? v : null);

export interface NoticeSnapshot { version: string; sha256: string; text: string }

/** Canonical English text of a tenant's notice and its SHA-256. The text is what notice_versions stores; the hash is what consent rows cite. */
export function noticeSnapshot(w: PublicWorkspace, t: PrT): NoticeSnapshot {
  const n = buildNotice(w, t);
  const text = [`${n.title}`, `Version: ${n.version}`, n.effective ? `Effective: ${n.effective}` : "", ...n.sections.flatMap((s) => [`## ${s.heading}`, ...s.body])]
    .filter((x) => x !== "").join("\n").slice(0, 60_000);
  return { version: n.version.slice(0, 40), sha256: createHash("sha256").update(text, "utf8").digest("hex"), text };
}

export interface ConsentEvidence {
  noticeVersion: string; noticeSha256: string | null; formId: string | null; ipHash: string | null; uaClass: UaClass | null;
}

/** The consent_log columns added by 0032. Null values are written as null. */
export function evidenceColumns(e: Pick<ConsentEvidence, "noticeSha256" | "formId" | "ipHash" | "uaClass">): Record<string, string | null> {
  return { notice_sha256: e.noticeSha256, form_id: cleanFormId(e.formId), ip_hash: e.ipHash, ua_class: e.uaClass };
}
export const EVIDENCE_COLUMN_NAMES = ["notice_sha256", "form_id", "ip_hash", "ua_class"] as const;
