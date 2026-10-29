// Rate limiter: in-memory fixed-window bucket per server instance, behind a pluggable store so a
// DB-backed rate_limit_hit() store (migration 0014+) can replace it without touching callers.

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterSec: number };
export type RateLimitStore = { hit(key: string, limit: number, windowMs: number, now: number): Promise<RateLimitResult> | RateLimitResult };

export function memoryStore(): RateLimitStore & { reset(): void } {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    hit(key, limit, windowMs, now) {
      let b = buckets.get(key);
      if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
      b.count += 1;
      if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
    },
    reset: () => buckets.clear(),
  };
}

const defaultStore = memoryStore();

export const LIMITS = {
  login: { limit: 10, windowMs: 60_000 },
  passwordReset: { limit: 5, windowMs: 15 * 60_000 },
  invite: { limit: 20, windowMs: 60 * 60_000 },
  api: { limit: 120, windowMs: 60_000 },
  webhookInbound: { limit: 300, windowMs: 60_000 },
} as const;

export async function rateLimit(
  scope: string, id: string, cfg: { limit: number; windowMs: number },
  opts: { store?: RateLimitStore; now?: number } = {},
): Promise<RateLimitResult> {
  return (opts.store ?? defaultStore).hit(`${scope}:${id}`, cfg.limit, cfg.windowMs, opts.now ?? Date.now());
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return r.ok ? {} : { "Retry-After": String(r.retryAfterSec) };
}

/** Best-effort client key from proxy headers. */
export function clientKey(h: { get(name: string): string | null }): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
