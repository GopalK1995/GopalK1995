// Per-key rate limit: src/lib/security/rate-limit.ts for counts and headers (per instance), plus the shared database
// counter public.rate_limit_hit() for enforcement across instances. A database error degrades to the in-memory limit.
import { rateLimit, memoryStore, LIMITS, type RateLimitResult, type RateLimitStore } from "../security/rate-limit";
import { serviceDb } from "../db/service";

export const DEFAULT_KEY_LIMIT = LIMITS.api;

export interface RpcDb { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }

export function dbBackedStore(local: RateLimitStore, getDb: () => RpcDb = () => serviceDb() as unknown as RpcDb): RateLimitStore {
  return {
    async hit(key, limit, windowMs, now) {
      const mem = await local.hit(key, limit, windowMs, now);
      try {
        const { data, error } = await getDb().rpc("rate_limit_hit", { p_bucket: key.slice(0, 200), p_limit: limit, p_window_s: Math.max(1, Math.round(windowMs / 1000)) });
        if (!error && data === false) return { ok: false, remaining: 0, retryAfterSec: Math.max(mem.retryAfterSec, 1) };
      } catch { /* fall through to the in-memory verdict */ }
      return mem;
    },
  };
}

const shared = dbBackedStore(memoryStore());

export function checkKeyRate(keyId: string, limit = DEFAULT_KEY_LIMIT.limit, opts: { store?: RateLimitStore; now?: number } = {}): Promise<RateLimitResult & { limit: number }> {
  return rateLimit("apikey", keyId, { limit, windowMs: DEFAULT_KEY_LIMIT.windowMs }, { store: opts.store ?? shared, now: opts.now }).then((r) => ({ ...r, limit }));
}

export function rateHeaders(r: RateLimitResult & { limit: number }, now = Date.now()): Record<string, string> {
  return {
    "RateLimit-Limit": String(r.limit), "RateLimit-Remaining": String(r.remaining), "RateLimit-Reset": String(r.retryAfterSec),
    ...(r.ok ? {} : { "Retry-After": String(r.retryAfterSec) }),
    "x-ratelimit-reset-at": String(Math.floor(now / 1000) + r.retryAfterSec),
  };
}
