// Pure request handler for GET /api/search (dependencies injected so it is unit-testable without Next).
import { clientKey, rateLimit, rateLimitHeaders, type RateLimitResult } from "@/lib/security/rate-limit";
import { REQUEST_ID_HEADER, requestIdFrom } from "@/lib/obs/request-id";
import { sanitizeQuery } from "./sanitize";
import type { SearchResponse } from "./types";

/** Typing is bursty (debounced client, one request per pause): 30 requests per 10 seconds per user. */
export const SEARCH_LIMIT = { limit: 30, windowMs: 10_000 } as const;

export interface HandlerDeps {
  uid: () => Promise<string | null>;
  run: (q: string) => Promise<SearchResponse>;
  limit?: (key: string) => Promise<RateLimitResult>;
}

const json = (body: unknown, status: number, rid: string, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", [REQUEST_ID_HEADER]: rid, ...extra } });

export async function handleSearch(req: Request, deps: HandlerDeps): Promise<Response> {
  const rid = requestIdFrom(req.headers);
  // Cross-site requests are never ours; a browser says so with Fetch Metadata.
  if (req.headers.get("sec-fetch-site") === "cross-site") return json({ error: "forbidden" }, 403, rid);
  const uid = await deps.uid().catch(() => null);
  if (!uid) return json({ error: "unauthenticated" }, 401, rid);
  const rl = await (deps.limit ?? ((k) => rateLimit("search", k, SEARCH_LIMIT)))(`${uid}:${clientKey(req.headers)}`);
  if (!rl.ok) return json({ error: "rate_limited" }, 429, rid, rateLimitHeaders(rl));
  const { q, tooShort } = sanitizeQuery(new URL(req.url).searchParams.get("q"));
  if (tooShort) return json({ hits: [], tooShort: true } satisfies SearchResponse, 200, rid);
  try {
    return json(await deps.run(q), 200, rid);
  } catch (e) {
    // Never echo the cause: it can name tables or policies. The request id ties the response to the server log.
    console.error("[search] failed", rid, e instanceof Error ? e.message : "error");
    return json({ error: "search_failed" }, 500, rid);
  }
}
