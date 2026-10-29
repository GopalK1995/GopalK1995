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
export const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};
const enc = new TextEncoder();
export const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
export async function hmac(data: string) {
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

// ---- Real-auth helpers (pure, unit-tested) ----
export type Membership = { ws: string; role: Role };
export const COOKIE_PREFIX = "gcrm_";
/** True for every cookie this app owns (session, workspace, support, per-tenant config). Logout clears them all. */
export const isAppCookie = (name: string) => name.startsWith(COOKIE_PREFIX);

/** Same message for every credential failure, so the form never reveals whether an account exists. */
export const GENERIC_AUTH_ERROR = "credentials";
/** Login throttle: attempts per window, keyed by email and by client address. */
export const LOGIN_LIMIT = { perEmail: 8, perIp: 30, windowS: 900 } as const;
export const RESET_LIMIT = { perEmail: 3, perIp: 10, windowS: 3600 } as const;
export function throttleBucket(kind: "login" | "reset", dimension: "email" | "ip", value: string): string {
  return `${kind}:${dimension}:${value.trim().toLowerCase().slice(0, 150)}`;
}
export const clientIp = (forwardedFor: string | null | undefined) => (forwardedFor?.split(",")[0] ?? "").trim() || "unknown";

/** Build the signed-cookie payload from what Supabase says right now. Cookie claims are routing hints only. */
export function buildLiveSession(input: { uid: string; email: string; fullName?: string | null; platformAdmin: boolean; memberships: Membership[]; now?: number }): Session {
  return { uid: input.uid, name: input.fullName || input.email, email: input.email, demo: false, platformAdmin: input.platformAdmin, memberships: input.memberships, iat: input.now ?? Date.now() };
}

/** Re-sign an existing session after a refresh: memberships and admin flag come from the database, identity stays. */
export function reSign(prev: Session, fresh: { platformAdmin: boolean; memberships: Membership[]; fullName?: string | null }, now = Date.now()): Session {
  return { ...prev, name: fresh.fullName || prev.name, platformAdmin: fresh.platformAdmin, memberships: fresh.memberships, iat: now };
}

/** Where a signed-in user must go before a session cookie is issued, given Supabase assurance levels. */
export function mfaStep(a: { current: string | null | undefined; next: string | null | undefined }, opts: { platformAdmin: boolean; hasVerifiedTotp: boolean }): "none" | "challenge" | "enrol" {
  if (a.current === "aal2") return "none";
  if (opts.hasVerifiedTotp || a.next === "aal2") return "challenge";
  return opts.platformAdmin ? "enrol" : "none";
}

/** Minimum bar for a new password: 10+ characters with a letter and a digit. Returns an error code or null. */
export function passwordProblem(pw: string, confirm?: string): "short" | "weak" | "mismatch" | null {
  if (pw.length < 10) return "short";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "weak";
  if (confirm !== undefined && pw !== confirm) return "mismatch";
  return null;
}
export const TOTP_RE = /^\d{6}$/;
