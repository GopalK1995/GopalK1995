// Signed cookie codec for demo-mode overrides. Web Crypto only (HMAC-SHA256 with the session secret), so it runs
// in middleware (edge) and in Node. The cookie holds ONLY the overrides; the value is `base64url(json).signature`.
import { b64url, fromB64url, hmac, safeEqual } from "../auth/session";
import { validateOverrides, type ConfigOverrides } from "./types";

export const CFG_COOKIE_PREFIX = "gcrm_cfg_";
export const CFG_COOKIE_MAX_BYTES = 3500;
export const CFG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const cfgCookieName = (tenantId: string) => `${CFG_COOKIE_PREFIX}${tenantId}`;
export interface CookiePayload { t: string; ver: number; at: string; by: string; ovr: ConfigOverrides }

const enc = new TextEncoder();
export async function encodeCfgCookie(p: CookiePayload): Promise<{ ok: true; value: string } | { ok: false; message: string; bytes: number }> {
  const body = b64url(enc.encode(JSON.stringify(p)));
  const value = `${body}.${await hmac(body)}`;
  if (value.length > CFG_COOKIE_MAX_BYTES) {
    return { ok: false, bytes: value.length, message: `This configuration is too large to keep in the browser in demo mode (${value.length.toLocaleString("en-IN")} of ${CFG_COOKIE_MAX_BYTES.toLocaleString("en-IN")} bytes). Reset some sections to the preset and try again.` };
  }
  return { ok: true, value };
}
/** Verify signature + tenant binding, then re-validate leniently (drops anything not allow-listed). */
export async function decodeCfgCookie(tenantId: string, value: string | undefined | null): Promise<CookiePayload | null> {
  if (!value) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig || !safeEqual(await hmac(body), sig)) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as CookiePayload;
    if (p.t !== tenantId || typeof p.ver !== "number") return null;
    return { ...p, ovr: validateOverrides(p.ovr, { strict: false }).value };
  } catch { return null; }
}
