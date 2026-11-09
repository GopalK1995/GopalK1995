// Creates a payment link (or an order) for a deal, lead or booking record. The local payments row is written FIRST (status created) and its
// id is the vendor reference_id / receipt and a note, so a webhook can always be matched back and a retry can never charge twice:
// the vendor refuses a repeated reference id. Amounts are integer paise (minor units); a deal's decimal value is converted exactly.
import { CredentialError, TransientError, type ConnectionRow } from "../core/types";
import { DEFAULT_CURRENCY, MAX_AMOUNT_MINOR } from "./constants";
import type { RazorpayGateway } from "./gateway";
import { isTransientFailure, RazorpayApiError } from "./gateway";
import { MoneyError, assertMinor, isCurrency, majorToMinorRounded } from "./money";
import { isSettled } from "./status";
import type { PaymentRow, RzpDeps } from "./store";

export interface PaymentRequest {
  /** Integer minor units. Omitted = the deal's value. */
  amountPaise?: number; currency?: string;
  dealId?: string; leadId?: string; recordId?: string;
  description?: string; kind?: "link" | "order";
  /** Only what the vendor page needs. Razorpay's own SMS/email notifications are always off: the tenant shares the link on a consented channel. */
  customer?: { name?: string; email?: string; contact?: string };
  expiresAt?: Date; callbackUrl?: string; createdBy?: string | null;
}
export type CreateFailure = "invalid_amount" | "invalid_currency" | "too_large" | "no_target" | "deal_not_found" | "amount_mismatch" | "gateway_rejected" | "transient" | "credentials";
export type CreateResult =
  | { ok: true; payment: PaymentRow; url: string | null; reused: boolean; showcase: boolean }
  | { ok: false; code: CreateFailure; paymentId?: string };

const cut = (s: string | undefined, n: number): string => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export async function createPaymentRequest(deps: RzpDeps, conn: ConnectionRow, gateway: RazorpayGateway, req: PaymentRequest): Promise<CreateResult> {
  const { store } = deps;
  const currency = req.currency ?? DEFAULT_CURRENCY;
  if (!isCurrency(currency)) return { ok: false, code: "invalid_currency" };
  if (!req.dealId && !req.leadId && !req.recordId) return { ok: false, code: "no_target" };

  let deal = null;
  if (req.dealId) {
    deal = await store.getDeal(conn.workspaceId, req.dealId);
    if (!deal) return { ok: false, code: "deal_not_found" };   // also covers a deal id from another workspace
  }
  let amount: number;
  try {
    amount = req.amountPaise !== undefined ? assertMinor(req.amountPaise, MAX_AMOUNT_MINOR) : deal ? majorToMinorRounded(deal.valueInr, currency, MAX_AMOUNT_MINOR) : assertMinor(undefined, MAX_AMOUNT_MINOR);
  } catch (e) {
    return { ok: false, code: e instanceof MoneyError ? e.code : "invalid_amount" };
  }

  // One open request per deal: asking again returns the same link instead of a second one.
  if (req.dealId) {
    const open = (await store.openPaymentsForDeal(conn.workspaceId, req.dealId)).find((p) => !isSettled(p.status) && p.externalId && p.integrationId === conn.id);
    if (open) return open.amountPaise === amount && open.currency === currency ? { ok: true, payment: open, url: open.linkUrl, reused: true, showcase: gateway.kind === "mock" } : { ok: false, code: "amount_mismatch", paymentId: open.id };
  }

  const pay = await store.insertPayment({ tenantId: conn.tenantId, workspaceId: conn.workspaceId, integrationId: conn.id, amountPaise: amount, currency, leadId: req.leadId ?? deal?.leadId ?? null, dealId: req.dealId ?? null, recordId: req.recordId ?? null, createdBy: req.createdBy ?? null });
  const notes = { crm_payment_id: pay.id };
  const description = cut(req.description ?? deal?.name, 255) || "Payment";
  try {
    let externalId: string, url: string | null = null;
    if (req.kind === "order") {
      externalId = (await gateway.createOrder({ amount, currency, receipt: pay.id, notes })).id;
    } else {
      const l = await gateway.createPaymentLink({
        amount, currency, referenceId: pay.id, description, notes, customer: req.customer,
        expireBy: req.expiresAt ? Math.floor(req.expiresAt.getTime() / 1000) : undefined, callbackUrl: req.callbackUrl,
      });
      externalId = l.id; url = l.shortUrl;
    }
    await store.updatePayment(conn.workspaceId, pay.id, { externalId, ...(url ? { linkUrl: url } : {}) });
    await store.emit({ type: "payment.created", workspaceId: conn.workspaceId, objectType: "payment", objectId: pay.id, data: { provider: "razorpay", kind: req.kind ?? "link", amount_paise: amount, currency, ...(req.dealId ? { deal_id: req.dealId } : {}) } });
    return { ok: true, payment: { ...pay, externalId, linkUrl: url }, url, reused: false, showcase: gateway.kind === "mock" };
  } catch (e) {
    await store.updatePayment(conn.workspaceId, pay.id, { status: "cancelled", failureCode: "create_failed" }).catch(() => undefined);
    deps.log.warn("razorpay payment request failed", { payment: pay.id, reason: e instanceof Error ? e.name : "error" });
    if (e instanceof CredentialError) return { ok: false, code: "credentials", paymentId: pay.id };
    if (isTransientFailure(e) || e instanceof TransientError) return { ok: false, code: "transient", paymentId: pay.id };
    return { ok: false, code: e instanceof RazorpayApiError ? "gateway_rejected" : "gateway_rejected", paymentId: pay.id };
  }
}
