// Razorpay webhook body -> normalised events. Follows the published schema:
//   { entity: "event", account_id, event, contains: [...], payload: { payment|payment_link|order|refund: { entity: {...} } }, created_at }
// Pure and defensive: unknown event names come back as `ignored`, malformed bodies as no events. Amounts are integer minor units already.
import { createHash } from "node:crypto";
import type { PayStatus } from "./status";

type R = Record<string, unknown>;
const obj = (v: unknown): R | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as R) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const int = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);
const entity = (payload: R | undefined, key: string): R | undefined => obj(obj(payload?.[key])?.entity);

export interface RzpRefs { paymentLinkId?: string; orderId?: string; paymentId?: string; referenceId?: string; crmPaymentId?: string }
export type RzpEvent =
  | { kind: "payment"; eventId: string; event: string; accountId?: string; at?: string; target: PayStatus; refs: RzpRefs; amount?: number; currency?: string; amountPaid?: number; method?: string; failure?: { code?: string; reason?: string } }
  | { kind: "refund"; eventId: string; event: string; accountId?: string; at?: string; refs: RzpRefs; refundId?: string; refundAmount?: number; currency?: string; paymentAmount?: number; amountRefundedTotal?: number; refundStatus: "created" | "processed" | "failed" }
  | { kind: "ignored"; eventId: string; event: string; accountId?: string };

const TARGET: Record<string, PayStatus> = {
  "payment_link.paid": "paid", "payment.captured": "paid", "order.paid": "paid",
  "payment_link.partially_paid": "pending", "payment.authorized": "pending",
  "payment.failed": "failed", "payment_link.cancelled": "cancelled", "payment_link.expired": "cancelled",
};

/** The vendor event id header, or a body hash when the header is missing (a redelivery of the same body hashes the same). */
export function eventIdOf(headers: Record<string, string> | undefined, rawBody: string): string {
  const h = headers?.["x-razorpay-event-id"];
  return h && h.length <= 200 ? h : `sha256:${createHash("sha256").update(rawBody, "utf8").digest("hex")}`;
}

const iso = (sec: unknown): string | undefined => (typeof sec === "number" && Number.isFinite(sec) ? new Date(sec * 1000).toISOString() : undefined);

export function parseWebhook(rawBody: string, headers?: Record<string, string>): RzpEvent[] {
  let j: unknown;
  try { j = JSON.parse(rawBody); } catch { return []; }
  const root = obj(j), event = str(root?.event);
  if (!root || !event) return [];
  const eventId = eventIdOf(headers, rawBody), accountId = str(root.account_id), at = iso(root.created_at);
  const payload = obj(root.payload);
  const pay = entity(payload, "payment"), link = entity(payload, "payment_link"), order = entity(payload, "order"), refund = entity(payload, "refund");
  const notes = obj(pay?.notes) ?? obj(link?.notes) ?? obj(order?.notes);
  const refs: RzpRefs = {
    paymentLinkId: str(link?.id), orderId: str(pay?.order_id) ?? str(link?.order_id) ?? str(order?.id), paymentId: str(pay?.id) ?? str(refund?.payment_id),
    referenceId: str(link?.reference_id), crmPaymentId: str(notes?.crm_payment_id),
  };

  if (event.startsWith("refund.")) {
    const st = event === "refund.created" ? "created" : event === "refund.processed" ? "processed" : event === "refund.failed" ? "failed" : null;
    if (!st) return [{ kind: "ignored", eventId, event, accountId }];
    return [{ kind: "refund", eventId, event, accountId, at, refs, refundId: str(refund?.id), refundAmount: int(refund?.amount), currency: str(refund?.currency) ?? str(pay?.currency), paymentAmount: int(pay?.amount), amountRefundedTotal: int(pay?.amount_refunded), refundStatus: st }];
  }
  const target = TARGET[event];
  if (!target) return [{ kind: "ignored", eventId, event, accountId }];
  if (!refs.paymentLinkId && !refs.orderId && !refs.paymentId && !refs.crmPaymentId) return [];
  const failure = target === "failed" ? { code: str(pay?.error_code), reason: str(pay?.error_description) } : undefined;
  return [{
    kind: "payment", eventId, event, accountId, at, target, refs,
    amount: int(link?.amount) ?? int(pay?.amount) ?? int(order?.amount), currency: str(link?.currency) ?? str(pay?.currency) ?? str(order?.currency),
    amountPaid: int(link?.amount_paid) ?? int(order?.amount_paid) ?? int(pay?.amount), method: str(pay?.method), failure,
  }];
}
