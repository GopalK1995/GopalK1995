// Shared primitives for the vendor webhook verifiers. Pure Node crypto, no server-only import, so unit tests run anywhere.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifyOpts { now?: number; fetchKeys?: () => Promise<Record<string, unknown>[]> }
/** Pseudo headers the route sets itself (a client value is always overwritten): request method, full URL, and the `k` query value. */
export const HOOK_METHOD = "x-hook-method", HOOK_URL = "x-hook-url", HOOK_KEY = "x-hook-key";

export type Verifier = (raw: string, headers: Headers, secret: string, opts?: VerifyOpts) => boolean | Promise<boolean>;

export const hmac = (secret: string | Buffer, data: string, enc: "hex" | "base64"): string => createHmac("sha256", secret).update(data, "utf8").digest(enc);

/** Constant-time string compare. Different lengths return false without leaking which byte differed. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8"), y = Buffer.from(b, "utf8");
  if (x.length !== y.length) { timingSafeEqual(x, x); return false; }
  return timingSafeEqual(x, y);
}
/** True when `ts` (seconds, or ms when `unit` is "ms") is within `toleranceSec` of now, in either direction. */
export function withinWindow(ts: number, toleranceSec: number, now = Date.now(), unit: "s" | "ms" = "s"): boolean {
  if (!Number.isFinite(ts)) return false;
  const ms = unit === "s" ? ts * 1000 : ts;
  return Math.abs(now - ms) <= toleranceSec * 1000;
}
export const stripPrefix = (v: string | null, prefix: string): string | null => (v && v.startsWith(prefix) ? v.slice(prefix.length) : null);
