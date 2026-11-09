// Signed, expiring unsubscribe tokens. v1.<base64url payload>.<base64url HMAC-SHA256>. The payload names the workspace, the
// connection and the lead (or the hashed address when there is no lead); it never carries an email address or a name.
import { createHmac, timingSafeEqual } from "node:crypto";
import { UNSUBSCRIBE_ONE_CLICK_PATH, UNSUBSCRIBE_PATH, UNSUBSCRIBE_TTL_DAYS } from "./constants";

export interface UnsubPayload { t: string; w: string; c: string; l: string | null; s: string | null; exp: number }
export type TokenCheck = { ok: true; value: UnsubPayload } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

const mac = (secret: string, body: string) => createHmac("sha256", `unsubscribe|${secret}`).update(body).digest();

export function signUnsubscribe(p: Omit<UnsubPayload, "exp">, secret: string, nowMs = Date.now(), ttlDays = UNSUBSCRIBE_TTL_DAYS): string {
  if (!secret) throw new Error("unsubscribe: signing secret missing");
  if (!p.l && !p.s) throw new Error("unsubscribe: a lead id or a subject hash is required");
  const body = Buffer.from(JSON.stringify({ ...p, exp: nowMs + ttlDays * 86_400_000 })).toString("base64url");
  return `v1.${body}.${mac(secret, body).toString("base64url")}`;
}
export function verifyUnsubscribe(token: string | null | undefined, secret: string, nowMs = Date.now()): TokenCheck {
  if (!token || !secret || token.length > 1024) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) return { ok: false, reason: "malformed" };
  const expected = mac(secret, parts[1]), given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };
  try {
    const v = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as UnsubPayload;
    if (typeof v.exp !== "number" || typeof v.t !== "string" || typeof v.w !== "string" || typeof v.c !== "string" || (!v.l && !v.s)) return { ok: false, reason: "malformed" };
    if (v.exp < nowMs) return { ok: false, reason: "expired" };
    return { ok: true, value: v };
  } catch { return { ok: false, reason: "malformed" }; }
}
const trimBase = (b: string) => b.replace(/\/+$/, "");
export const unsubscribePageUrl = (base: string, token: string): string => `${trimBase(base)}${UNSUBSCRIBE_PATH}/${token}`;
export const unsubscribeOneClickUrl = (base: string, token: string): string => `${trimBase(base)}${UNSUBSCRIBE_ONE_CLICK_PATH}/${token}`;
