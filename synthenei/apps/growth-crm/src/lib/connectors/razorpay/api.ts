// Real Razorpay REST gateway over fetch (HTTP Basic: key id : key secret). Used only with real credentials (see config.ts).
// Retries 429/5xx/network errors with the framework backoff and honours Retry-After; keeps the vendor code; never logs or echoes
// bodies, keys or customer details. Creates are safe to retry because of a stable reference_id / receipt (the vendor refuses duplicates).
import { backoffMs, parseRetryAfter } from "../core/http";
import { DEFAULT_RATE_POLICY, TransientError, type RateLimitPolicy } from "../core/types";
import { errorFromResponse, type AccountProbe, type CreateLinkInput, type CreateOrderInput, type LinkResult, type OrderResult, type RazorpayGateway, type RefundInfo } from "./gateway";

export interface ApiOpts {
  apiBase: string; keyId: string; keySecret: string;
  fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; random?: () => number; policy?: Partial<RateLimitPolicy>;
}
type R = Record<string, unknown>;

export function makeApiGateway(o: ApiOpts): RazorpayGateway {
  const p = { ...DEFAULT_RATE_POLICY, maxRetries: 4, ...o.policy };
  const doFetch = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = o.apiBase.replace(/\/+$/, "");
  const auth = `Basic ${Buffer.from(`${o.keyId}:${o.keySecret}`, "utf8").toString("base64")}`;

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await doFetch(`${base}/${path.replace(/^\/+/, "")}`, {
          method, headers: { authorization: auth, accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        if (attempt >= p.maxRetries) throw new TransientError("Razorpay API unreachable");
        await sleep(backoffMs(attempt, p, o.random));
        continue;
      }
      if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
      if (res.status === 429 || res.status >= 500) {
        const ra = parseRetryAfter(res.headers.get("retry-after"));
        if (attempt >= p.maxRetries) throw new TransientError(`Razorpay API kept failing (HTTP ${res.status})`, ra);
        await sleep(Math.min(p.maxDelayMs, ra ?? backoffMs(attempt, p, o.random)));
        continue;
      }
      let errBody: unknown = null;
      try { errBody = await res.json(); } catch { /* no body */ }
      throw errorFromResponse(res.status, errBody);
    }
  }
  const need = (v: unknown, what: string): string => { if (typeof v !== "string" || !v) throw new TransientError(`Razorpay API answered without ${what}`); return v; };

  return {
    kind: "api",
    async probe(): Promise<AccountProbe> {
      await call<R>("GET", "v1/payments?count=1");   // cheapest authenticated read; 401 = bad keys
      return { ok: true, mode: o.keyId.startsWith("rzp_live_") ? "live" : "test" };
    },
    async createPaymentLink(i: CreateLinkInput): Promise<LinkResult> {
      const r = await call<R>("POST", "v1/payment_links", {
        amount: i.amount, currency: i.currency, reference_id: i.referenceId, description: i.description, notes: i.notes,
        // Razorpay must not message the customer on its own: the tenant shares the link through a consented channel.
        notify: { sms: false, email: false }, reminder_enable: false,
        ...(i.customer ? { customer: i.customer } : {}), ...(i.expireBy ? { expire_by: i.expireBy } : {}),
        ...(i.callbackUrl ? { callback_url: i.callbackUrl, callback_method: "get" } : {}),
      });
      return { id: need(r.id, "an id"), shortUrl: need(r.short_url, "a url"), status: String(r.status ?? "created") };
    },
    async cancelPaymentLink(id) { await call<R>("POST", `v1/payment_links/${encodeURIComponent(id)}/cancel`, {}); },
    async createOrder(i: CreateOrderInput): Promise<OrderResult> {
      const r = await call<R>("POST", "v1/orders", { amount: i.amount, currency: i.currency, receipt: i.receipt, notes: i.notes });
      return { id: need(r.id, "an id"), status: String(r.status ?? "created") };
    },
    async listRefunds(paymentId): Promise<RefundInfo[]> {
      const r = await call<{ items?: R[] }>("GET", `v1/payments/${encodeURIComponent(paymentId)}/refunds?count=100`);
      return (r.items ?? []).flatMap((x) => typeof x.id === "string" && typeof x.amount === "number"
        ? [{ id: x.id, paymentId, amount: x.amount, currency: String(x.currency ?? ""), status: String(x.status ?? ""), createdAt: typeof x.created_at === "number" ? new Date(x.created_at * 1000).toISOString() : undefined }] : []);
    },
  };
}
