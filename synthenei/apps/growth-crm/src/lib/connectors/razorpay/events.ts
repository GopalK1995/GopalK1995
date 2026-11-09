// Inbound pipeline: one parsed Razorpay event -> payments row, deal stage and audit event. Runs from the connector_inbound consumer
// AFTER the edge verified X-Razorpay-Signature on the raw body (verify/receive.ts); nothing here re-checks signatures.
// Idempotent three ways: the receiver dedupes by X-Razorpay-Event-Id, a payment remembers the last event id it applied (raw_ref), and
// the status machine only moves forward, so a replay or a late event is a no-op and emits nothing.
import type { ConnectionRow, ConnectionSecrets } from "../core/types";
import { CRED } from "./constants";
import type { RzpEvent } from "./payload";
import { canTransition, type PayStatus } from "./status";
import type { PaymentEventType, PaymentRow, RzpDeps } from "./store";

export interface EventCtx { deps: RzpDeps; conn: ConnectionRow; secrets: ConnectionSecrets; reject: (reason: string) => void }

const EVENT_OF: Partial<Record<PayStatus, PaymentEventType>> = { paid: "payment.paid", failed: "payment.failed", cancelled: "payment.cancelled", refunded: "payment.refunded" };

/** Connection setting: the stage key (in the deal's own pipeline) a deal moves to when its payment is received. Unset = no stage move. */
export const PAID_STAGE_SETTING = "paid_stage_key";

/** Tenant isolation, second line (the first: the signing secret and the payment lookup are both per connection/workspace).
 *  When the connection stores its Razorpay account id (settings.account_id, pattern ACCOUNT_ID_PATTERN), an event for any other account is refused. */
export function ownsAccount(conn: ConnectionRow, accountId: string | undefined): boolean {
  const mine = conn.settings[CRED.accountId];
  return typeof mine !== "string" || !mine || mine === accountId;
}

export async function handleEvent(c: EventCtx, evt: RzpEvent): Promise<void> {
  if (evt.kind === "ignored") return;
  if (!ownsAccount(c.conn, evt.accountId)) { c.reject("account_mismatch"); return; }   // never touch another account's payments
  const { deps, conn } = c;
  const externalIds = [evt.refs.paymentLinkId, evt.refs.orderId].filter((x): x is string => !!x);
  const pay = await deps.store.findPayment(conn.workspaceId, { id: evt.refs.crmPaymentId, externalIds });
  if (!pay) { c.reject("unknown_payment"); return; }
  if (pay.integrationId && pay.integrationId !== conn.id) { c.reject("other_connection"); return; }
  if (pay.rawRef === evt.eventId) return;   // exact redelivery

  if (evt.kind === "refund") return handleRefund(c, evt, pay);

  if (evt.target === "paid" || evt.target === "pending") {
    // A payment is applied only when the vendor's amount and currency equal what this system asked for.
    const claimed = evt.target === "paid" ? evt.amountPaid ?? evt.amount : evt.amount;
    if ((claimed !== undefined && claimed !== pay.amountPaise) || (evt.currency && evt.currency !== pay.currency)) { await mismatch(c, pay, evt.eventId, "amount_or_currency"); return; }
  }
  if (!canTransition(pay.status, evt.target)) return;   // replay, retry after paid, or an out-of-order event

  const patch = { status: evt.target, rawRef: evt.eventId, ...(evt.target === "paid" ? { paidAt: evt.at ?? deps.now().toISOString() } : {}), ...(evt.target === "failed" ? { failureCode: evt.failure?.code ?? null } : {}) };
  if (!(await deps.store.updatePayment(conn.workspaceId, pay.id, patch))) { c.reject("payment_vanished"); return; }
  const type = EVENT_OF[evt.target];   // "pending" (authorised / partly paid) is stored but not announced
  if (type) await deps.store.emit({ type, workspaceId: conn.workspaceId, objectType: "payment", objectId: pay.id, data: { provider: "razorpay", status: evt.target, amount_paise: pay.amountPaise, currency: pay.currency, ...(evt.method ? { method: evt.method } : {}), ...(evt.failure?.code ? { failure_code: evt.failure.code } : {}), ...(pay.dealId ? { deal_id: pay.dealId } : {}) } });
  if (evt.target === "paid") await advanceDeal(c, pay);
}

async function handleRefund(c: EventCtx, evt: Extract<RzpEvent, { kind: "refund" }>, pay: PaymentRow): Promise<void> {
  if (evt.refundStatus !== "processed") return;   // created / failed: nothing is returned to the customer yet
  if (pay.status !== "paid") return;              // refund of something never marked paid here: ignore
  const total = evt.amountRefundedTotal ?? evt.refundAmount ?? 0;
  if (total <= 0) { c.reject("refund_without_amount"); return; }
  const full = total >= pay.amountPaise;
  const { deps, conn } = c;
  if (full) {
    if (!(await deps.store.updatePayment(conn.workspaceId, pay.id, { status: "refunded", rawRef: evt.eventId, refundedPaise: Math.min(total, pay.amountPaise) }))) { c.reject("payment_vanished"); return; }
    await deps.store.emit({ type: "payment.refunded", workspaceId: conn.workspaceId, objectType: "payment", objectId: pay.id, data: { provider: "razorpay", amount_paise: pay.amountPaise, currency: pay.currency, refunded_paise: pay.amountPaise } });
    return;
  }
  await deps.store.updatePayment(conn.workspaceId, pay.id, { rawRef: evt.eventId, refundedPaise: total });
  await deps.store.emit({ type: "payment.refund_partial", workspaceId: conn.workspaceId, objectType: "payment", objectId: pay.id, data: { provider: "razorpay", amount_paise: pay.amountPaise, currency: pay.currency, refunded_paise: total } });
}

async function mismatch(c: EventCtx, pay: PaymentRow, eventId: string, why: string): Promise<void> {
  c.reject("amount_mismatch");
  c.deps.log.warn("razorpay event not applied", { payment: pay.id, why });   // ids only: no amounts, no customer data
  await c.deps.store.emit({ type: "payment.mismatch", workspaceId: c.conn.workspaceId, objectType: "payment", objectId: pay.id, data: { provider: "razorpay", why, event_id: eventId } });
}

/** Stage move after a received payment; a failure here never undoes the payment (the next sync or an owner fixes the stage). */
async function advanceDeal(c: EventCtx, pay: PaymentRow): Promise<void> {
  const stageKey = c.conn.settings[PAID_STAGE_SETTING];
  if (!pay.dealId || typeof stageKey !== "string" || !stageKey) return;
  try {
    const deal = await c.deps.store.getDeal(c.conn.workspaceId, pay.dealId);
    if (!deal) { c.reject("deal_missing"); return; }
    const r = await c.deps.store.moveDealToStage(c.conn.tenantId, c.conn.workspaceId, deal, stageKey);
    if (r === "no_stage") c.reject("paid_stage_not_found");
  } catch {
    c.reject("deal_move_failed");
    c.deps.log.warn("razorpay deal stage move failed", { payment: pay.id });
  }
}
