// Login / reset throttle (AUD-056, SEC-003). The counter lives in public.rate_limits, but the database no longer lets a browser
// write to it: rate_limit_hit() is service-role only and auth_throttle_hit() (service-role only) fixes the bucket namespace and
// hashes the key. This module calls it with the service client from the server action, BEFORE authentication, so an anonymous
// visitor can still be throttled without being able to address a bucket.
//
// Works before and after migration 0025: if the new function (or the service key) is missing it falls back to the legacy call
// through the request client, and if that is refused too it fails OPEN (the throttle must never block sign-in on an infra error)
// and logs a warning.
import { throttleBucket } from "./session";

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> };
export interface ThrottleDeps { service?: () => Rpc; log?: (m: string) => void }

export type ThrottleLimit = { perEmail: number; perIp: number; windowS: number };

async function defaultService(): Promise<Rpc> {
  const { serviceDb } = await import("../db/service");
  return serviceDb() as unknown as Rpc;
}

/** One counter hit. Resolves true when the caller is still within the limit. */
export async function throttleHit(
  sb: Rpc, kind: "login" | "reset", dim: "email" | "ip", value: string, limit: number, windowS: number, deps: ThrottleDeps = {},
): Promise<boolean> {
  const log = deps.log ?? ((m: string) => console.warn(`[auth-throttle] ${m}`));
  try {
    const svc = deps.service ? deps.service() : await defaultService();
    const { data, error } = await svc.rpc("auth_throttle_hit", { p_kind: kind, p_dim: dim, p_value: value.trim().toLowerCase().slice(0, 320) || "unknown", p_limit: limit, p_window_s: windowS });
    if (!error) return data !== false;
    log(`auth_throttle_hit unavailable (${error.code ?? "error"}); trying the legacy bucket`);
  } catch (e) {
    log(`service client unavailable (${e instanceof Error ? e.message : "error"}); trying the legacy bucket`);
  }
  try {
    const { data, error } = await sb.rpc("rate_limit_hit", { p_bucket: throttleBucket(kind, dim, value), p_limit: limit, p_window_s: windowS });
    if (!error) return data !== false;
    log(`rate_limit_hit refused (${error.code ?? "error"}); throttle is failing open`);
  } catch { log("throttle failing open"); }
  return true;
}

/** True when the attempt must be refused (either the e-mail or the address is over its limit). */
export async function throttled(sb: Rpc, kind: "login" | "reset", email: string, ip: string, lim: ThrottleLimit, deps: ThrottleDeps = {}): Promise<boolean> {
  const a = await throttleHit(sb, kind, "email", email, lim.perEmail, lim.windowS, deps);
  const b = await throttleHit(sb, kind, "ip", ip, lim.perIp, lim.windowS, deps);
  return !(a && b);
}
