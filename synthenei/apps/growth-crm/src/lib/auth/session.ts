// Signed session cookie (HMAC-SHA256 via Web Crypto, so it runs in middleware and in Node).
// Demo mode only. With Supabase env vars, auth state comes from Supabase SSR cookies instead and the role is
// read from the user's profile; we still mirror it into this cookie for fast edge checks.
import type { Role } from "../data/types";

export const SESSION_COOKIE = "gcrm_session";
export const WS_COOKIE = "gcrm_ws";
export const SUPPORT_COOKIE = "gcrm_support";
/** Signed identity + memberships (role is per workspace, never global). */
export interface Session { uid: string; name: string; email: string; demo: boolean; platformAdmin: boolean; memberships: { ws: string; role: Role }[]; iat: number }
/** Platform-admin support session: time-boxed, reasoned, logged. */
export interface SupportSession { ws: string; mode: "read_only" | "read_write"; reason: string; admin: string; endsAt: number; iat: number }

const DEMO_FALLBACK = "growth-crm-demo-only-secret-change-me";
/**
 * SESSION_SECRET is required whenever real auth (Supabase) is configured. The public fallback is only accepted in
 * demo mode, where the tenant holds synthetic data only, so a forged cookie can expose nothing real.
 */
const secret = () => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("SESSION_SECRET must be set when Supabase auth is configured.");
  return DEMO_FALLBACK;
};
/** Constant-time string compare. */
const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};
const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
async function hmac(data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
export async function sign(obj: object) {
  const body = b64url(enc.encode(JSON.stringify(obj)));
  return `${body}.${await hmac(body)}`;
}
async function verify<T extends { iat: number }>(token: string | undefined | null, maxAgeMs: number): Promise<T | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(await hmac(body), sig)) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(fromB64url(body))) as T;
    if (Date.now() - s.iat > maxAgeMs) return null;
    return s;
  } catch { return null; }
}
export const signSession = (s: Session) => sign(s);
export const verifySession = (t: string | undefined | null) => verify<Session>(t, 1000 * 60 * 60 * 12);
export async function verifySupport(t: string | undefined | null) {
  const s = await verify<SupportSession>(t, 1000 * 60 * 60);
  return s && s.endsAt > Date.now() ? s : null;
}
