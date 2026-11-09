// Minimal Google REST client: bearer auth, JSON in/out, retries quota and 5xx answers with exponential backoff + jitter (honours
// Retry-After), maps every failure through errors.ts. Pure with injected fetch/sleep/random so backoff is unit-tested without a network.
import { backoffMs, parseRetryAfter } from "../../core/http";
import { TransientError } from "../../core/types";
import { BASE_DELAY_MS, MAX_DELAY_MS, MAX_RETRIES } from "./constants";
import { classify, errorFromResponse } from "./errors";

export interface GoogleHttpDeps { fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; random?: () => number; maxRetries?: number }
export interface GoogleRequest { method: "GET" | "POST"; url: string; token: string; headers?: Record<string, string>; body?: unknown }

export async function googleJson<T>(req: GoogleRequest, deps: GoogleHttpDeps = {}): Promise<T> {
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const max = deps.maxRetries ?? MAX_RETRIES;
  const policy = { requestsPerMinute: 0, maxRetries: max, baseDelayMs: BASE_DELAY_MS, maxDelayMs: MAX_DELAY_MS };
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(req.url, {
        method: req.method,
        headers: { accept: "application/json", authorization: `Bearer ${req.token}`, ...(req.body !== undefined ? { "content-type": "application/json" } : {}), ...req.headers },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
      });
    } catch {
      if (attempt >= max) throw new TransientError("Google unreachable");
      await sleep(backoffMs(attempt, policy, deps.random));
      continue;
    }
    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
    let body: unknown;
    try { body = await res.json(); } catch { body = undefined; }
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    const kind = classify(res.status, body);
    if ((kind === "quota" || kind === "server") && attempt < max) { await sleep(Math.min(MAX_DELAY_MS, retryAfter ?? backoffMs(attempt, policy, deps.random))); continue; }
    throw errorFromResponse(res.status, body, retryAfter);
  }
}

/** Builds `base + path` without doubling slashes; base comes from env or the vendor default. */
export const joinUrl = (base: string, path: string): string => `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
