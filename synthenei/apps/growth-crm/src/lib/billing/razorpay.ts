// Razorpay Subscriptions for Synthan's OWN billing. Test mode unless config says otherwise (see config.ts razorpayConfig).
// Distinct from connectors/razorpay (a tenant collecting from its own customers with its own keys). No env reads here: callers pass config.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { RazorpayConfig } from "./config";
import type { Interval, PlanRow } from "./types";

export class RazorpayError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "RazorpayError"; }
}
type Fetch = typeof fetch;

async function call<T>(cfg: RazorpayConfig, f: Fetch, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await f(`${cfg.apiBase}/v1${path}`, {
    method, signal: AbortSignal.timeout(15_000),
    headers: { authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) {
    const m = (json as { error?: { description?: string } } | null)?.error?.description;
    throw new RazorpayError(res.status, m ?? `Razorpay answered ${res.status}`);
  }
  return json as T;
}

export interface RzSubscription { id: string; status: string; short_url?: string; current_end?: number | null; plan_id?: string; notes?: Record<string, string> }

export function razorpayClient(cfg: RazorpayConfig, f: Fetch = fetch) {
  return {
    /** One Razorpay plan per (plan, interval). The amount comes from the plans table, tax is added on the invoice, not here. */
    createPlan: (p: Pick<PlanRow, "id" | "name">, interval: Interval, amountPaise: number) =>
      call<{ id: string }>(cfg, f, "POST", "/plans", {
        period: interval === "yearly" ? "yearly" : "monthly", interval: 1,
        item: { name: `${p.name} (${interval})`.slice(0, 100), amount: amountPaise, currency: "INR" }, notes: { plan_id: p.id },
      }),
    createSubscription: (a: { providerPlanId: string; appPlanId: string; tenantId: string; quantity: number; totalCount: number }) =>
      call<RzSubscription>(cfg, f, "POST", "/subscriptions", {
        plan_id: a.providerPlanId, total_count: a.totalCount, quantity: a.quantity, customer_notify: 1, notes: { tenant_id: a.tenantId, plan_id: a.appPlanId },
      }),
    cancelSubscription: (id: string, atCycleEnd: boolean) => call<RzSubscription>(cfg, f, "POST", `/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 }),
    fetchSubscription: (id: string) => call<RzSubscription>(cfg, f, "GET", `/subscriptions/${encodeURIComponent(id)}`),
  };
}
export type RazorpayClient = ReturnType<typeof razorpayClient>;

/** HMAC-SHA256 hex of the raw body, constant-time compare. */
export function verifyWebhook(secret: string | undefined, rawBody: string, signature: string | null): boolean {
  if (!secret || !signature) return false;
  const a = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")), b = Buffer.from(signature.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

export type SubEvent =
  | { kind: "activated" | "charged"; subscriptionId: string; tenantId: string | null; appPlanId: string | null; currentEnd: string | null; paymentId: string | null; amountPaise: number | null }
  | { kind: "past_due" | "cancelled"; subscriptionId: string; tenantId: string | null; appPlanId: string | null; currentEnd: string | null }
  | { kind: "ignore" };

/** Pure mapper from a webhook body to what the service acts on. Unknown events are ignored, never errors. */
export function mapSubscriptionEvent(body: unknown): SubEvent {
  const b = (body ?? {}) as { event?: string; payload?: { subscription?: { entity?: RzSubscription }; payment?: { entity?: { id?: string; amount?: number } } } };
  const sub = b.payload?.subscription?.entity;
  if (!b.event || !sub?.id) return { kind: "ignore" };
  const tenantId = typeof sub.notes?.tenant_id === "string" ? sub.notes.tenant_id : null;
  const currentEnd = typeof sub.current_end === "number" ? new Date(sub.current_end * 1000).toISOString() : null;
  const common = { subscriptionId: sub.id, tenantId, appPlanId: typeof sub.notes?.plan_id === "string" ? sub.notes.plan_id : null, currentEnd };
  switch (b.event) {
    case "subscription.activated": return { kind: "activated", ...common, paymentId: null, amountPaise: null };
    case "subscription.charged": return { kind: "charged", ...common, paymentId: b.payload?.payment?.entity?.id ?? null, amountPaise: b.payload?.payment?.entity?.amount ?? null };
    case "subscription.pending": case "subscription.halted": return { kind: "past_due", ...common };
    case "subscription.cancelled": case "subscription.completed": return { kind: "cancelled", ...common };
    default: return { kind: "ignore" };
  }
}
