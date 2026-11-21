// Shared vendor HTTP for the adapters: JSON POST, timeout, and retry with backoff on 429 / 5xx (honours Retry-After).
// Error messages never include the request (it carries the prompt) or any header (it carries the key).
import { AiError, type AdapterCtx } from "../types";

const RETRIES = 2;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function postJson(url: string, headers: Record<string, string>, body: unknown, ctx: AdapterCtx): Promise<unknown> {
  const sleep = ctx.sleep ?? wait;
  let last: AiError | null = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ctx.timeoutMs ?? 45_000);
    try {
      const res = await ctx.fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ac.signal });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        last = new AiError(res.status === 429 ? "rate_limited" : "provider_error", `Provider answered ${res.status}`, { status: res.status });
        if (attempt < RETRIES) { await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 20) * 1000 : 500 * 2 ** attempt); continue; }
        throw last;
      }
      throw new AiError("provider_error", `Provider answered ${res.status}`, { status: res.status }); // other 4xx: not retried (bad key, bad model)
    } catch (e) {
      if (e instanceof AiError) throw e;
      last = new AiError("provider_error", "Provider could not be reached", { aborted: (e as Error)?.name === "AbortError" });
      if (attempt < RETRIES) { await sleep(500 * 2 ** attempt); continue; }
      throw last;
    } finally { clearTimeout(timer); }
  }
  throw last ?? new AiError("provider_error");
}

export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);
export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
