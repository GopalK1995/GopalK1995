// Razorpay webhook bodies in the published schema (https://razorpay.com/docs/webhooks/payloads/) with synthetic ids.
// None are captures from a live account. Used by the unit tests and mirrored by the Cypress signed-fixture spec.
export const ACCOUNT = "acc_TestAccount001";
export const OTHER_ACCOUNT = "acc_OtherAccount02";
export const LINK = "plink_TestLink0001";
export const ORDER = "order_TestOrder001";
export const PAYMENT = "pay_TestPayment001";
export const CRM_PAYMENT = "7d1f3c52-2b6e-4f0a-9c1d-5a6b7c8d9e0f";
export const AT = 1_700_000_000;

interface Opts { amount?: number; currency?: string; account?: string; crmPayment?: string | null; link?: string; order?: string; payment?: string }
const notes = (o: Opts) => (o.crmPayment === null ? {} : { crm_payment_id: o.crmPayment ?? CRM_PAYMENT });

const paymentEntity = (o: Opts, extra: Record<string, unknown> = {}) => ({
  id: o.payment ?? PAYMENT, entity: "payment", amount: o.amount ?? 250000, currency: o.currency ?? "INR", status: "captured", order_id: o.order ?? ORDER,
  method: "upi", captured: true, description: "Test payment", email: "customer@example.test", contact: "+910000000000", notes: notes(o), created_at: AT, ...extra,
});
const wrap = (event: string, contains: string[], payload: Record<string, unknown>, o: Opts) =>
  JSON.stringify({ entity: "event", account_id: o.account ?? ACCOUNT, event, contains, payload, created_at: AT });

export const paymentLinkPaid = (o: Opts = {}): string => wrap("payment_link.paid", ["payment_link", "payment", "order"], {
  payment_link: { entity: { id: o.link ?? LINK, entity: "payment_link", amount: o.amount ?? 250000, amount_paid: o.amount ?? 250000, currency: o.currency ?? "INR", status: "paid", reference_id: o.crmPayment ?? CRM_PAYMENT, order_id: o.order ?? ORDER, notes: notes(o) } },
  payment: { entity: paymentEntity(o) },
  order: { entity: { id: o.order ?? ORDER, entity: "order", amount: o.amount ?? 250000, amount_paid: o.amount ?? 250000, currency: o.currency ?? "INR", status: "paid", notes: notes(o) } },
}, o);

export const paymentLinkPartiallyPaid = (o: Opts = {}): string => wrap("payment_link.partially_paid", ["payment_link", "payment"], {
  payment_link: { entity: { id: o.link ?? LINK, entity: "payment_link", amount: o.amount ?? 250000, amount_paid: 100000, currency: o.currency ?? "INR", status: "partially_paid", notes: notes(o) } },
  payment: { entity: paymentEntity(o, { amount: 100000 }) },
}, o);

export const paymentLinkExpired = (o: Opts = {}): string => wrap("payment_link.expired", ["payment_link"], {
  payment_link: { entity: { id: o.link ?? LINK, entity: "payment_link", amount: o.amount ?? 250000, amount_paid: 0, currency: o.currency ?? "INR", status: "expired", notes: notes(o) } },
}, o);

export const paymentCaptured = (o: Opts = {}): string => wrap("payment.captured", ["payment"], { payment: { entity: paymentEntity(o) } }, o);
export const paymentAuthorized = (o: Opts = {}): string => wrap("payment.authorized", ["payment"], { payment: { entity: paymentEntity(o, { status: "authorized", captured: false }) } }, o);
export const paymentFailed = (o: Opts = {}): string => wrap("payment.failed", ["payment"], {
  payment: { entity: paymentEntity(o, { status: "failed", captured: false, error_code: "BAD_REQUEST_ERROR", error_description: "Payment processing failed because of incorrect OTP", error_source: "customer", error_reason: "incorrect_otp" }) },
}, o);

export const refundProcessed = (o: Opts & { refund?: number; total?: number } = {}): string => wrap("refund.processed", ["refund", "payment"], {
  refund: { entity: { id: "rfnd_TestRefund0001", entity: "refund", amount: o.refund ?? o.amount ?? 250000, currency: o.currency ?? "INR", payment_id: o.payment ?? PAYMENT, status: "processed", notes: {}, created_at: AT } },
  payment: { entity: paymentEntity(o, { status: "refunded", amount_refunded: o.total ?? o.refund ?? o.amount ?? 250000, refund_status: "full" }) },
}, o);
export const refundCreated = (o: Opts = {}): string => refundProcessed(o).replace("refund.processed", "refund.created").replace('"status":"processed"', '"status":"pending"');
export const refundFailed = (o: Opts = {}): string => refundProcessed(o).replace("refund.processed", "refund.failed");

export const unknownEvent = (): string => JSON.stringify({ entity: "event", account_id: ACCOUNT, event: "settlement.processed", contains: ["settlement"], payload: {}, created_at: AT });
export const garbage = "not json";
