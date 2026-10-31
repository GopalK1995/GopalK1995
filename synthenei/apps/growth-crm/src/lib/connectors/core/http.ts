// Vendor HTTP client with the rate-limit/backoff policy: retries 429 and 5xx honouring Retry-After, exponential backoff with
// jitter, a hard cap on attempts. Error messages carry the status only: never headers, never the body (may hold PII/tokens).
import { CredentialError, DEFAULT_RATE_POLICY, TransientError, type HttpRequest, type RateLimitPolicy, type VendorHttp } from "./types";

export interface HttpDeps { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; random?: () => number }

/** Retry-After as seconds or HTTP date; undefined when absent or unparseable. Capped by the caller. */
export function parseRetryAfter(h: string | null | undefined, now = Date.now()): number | undefined {
  if (!h) return undefined;
  const n = Number(h);
  if (Number.isFinite(n)) return Math.max(0, n * 1000);
  const t = Date.parse(h);
  return Number.isNaN(t) ? undefined : Math.max(0, t - now);
}
export function backoffMs(attempt: number, p: RateLimitPolicy, random: () => number = Math.random): number {
  const exp = Math.min(p.maxDelayMs, p.baseDelayMs * 2 ** attempt);
  return Math.round(exp / 2 + random() * (exp / 2));
}

export function makeVendorHttp(policy: Partial<RateLimitPolicy> = {}, deps: HttpDeps = {}): VendorHttp {
  const p = { ...DEFAULT_RATE_POLICY, ...policy };
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    async json<T>(req: HttpRequest): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await doFetch(req.url, {
            method: req.method,
            headers: { accept: "application/json", ...(req.body !== undefined ? { "content-type": "application/json" } : {}), ...req.headers },
            body: req.body === undefined ? undefined : typeof req.body === "string" ? req.body : JSON.stringify(req.body),
          });
        } catch {
          if (attempt >= p.maxRetries) throw new TransientError("Vendor unreachable");
          await sleep(backoffMs(attempt, p, deps.random));
          continue;
        }
        if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
        if (res.status === 401 || res.status === 403) throw new CredentialError(`Vendor rejected the credentials (HTTP ${res.status})`);
        if (res.status === 429 || res.status >= 500) {
          const ra = parseRetryAfter(res.headers.get("retry-after"));
          if (attempt >= p.maxRetries) throw new TransientError(`Vendor kept failing (HTTP ${res.status})`, ra);
          await sleep(Math.min(p.maxDelayMs, ra ?? backoffMs(attempt, p, deps.random)));
          continue;
        }
        throw new Error(`Vendor request failed (HTTP ${res.status})`);
      }
    },
  };
}
