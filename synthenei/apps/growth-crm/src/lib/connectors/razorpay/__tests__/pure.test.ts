import { describe, expect, it } from "vitest";
import { MAX_AMOUNT_MINOR } from "../constants";
import { MoneyError, assertMinor, exponentOf, fromMinor, majorToMinorRounded, toMinor } from "../money";
import { eventIdOf, parseWebhook } from "../payload";
import { canTransition, type PayStatus } from "../status";
import * as F from "../__fixtures__/payloads";

const code = (fn: () => unknown): string | undefined => { try { fn(); } catch (e) { return e instanceof MoneyError ? e.code : "other"; } return undefined; };

describe("paise math", () => {
  it("converts decimal strings exactly, never through floats", () => {
    expect(toMinor("1234.50", "INR", MAX_AMOUNT_MINOR)).toBe(123450);
    expect(toMinor("0.10", "INR", MAX_AMOUNT_MINOR)).toBe(10);
    expect(toMinor("0.29", "INR", MAX_AMOUNT_MINOR)).toBe(29);   // 0.29 * 100 = 28.999999999999996 with floats
    expect(toMinor("19", "INR", MAX_AMOUNT_MINOR)).toBe(1900);
    expect(toMinor("5", "JPY", MAX_AMOUNT_MINOR)).toBe(5);
    expect(toMinor("1.234", "KWD", MAX_AMOUNT_MINOR)).toBe(1234);
  });
  it("rejects bad shapes, too many decimals, zero, negatives, huge values and bad currencies", () => {
    expect(code(() => toMinor("1.234", "INR", MAX_AMOUNT_MINOR))).toBe("invalid_amount");
    expect(code(() => toMinor("1.5", "JPY", MAX_AMOUNT_MINOR))).toBe("invalid_amount");
    expect(code(() => toMinor("-5", "INR", MAX_AMOUNT_MINOR))).toBe("invalid_amount");
    expect(code(() => toMinor("1e3", "INR", MAX_AMOUNT_MINOR))).toBe("invalid_amount");
    expect(code(() => toMinor("0", "INR", MAX_AMOUNT_MINOR))).toBe("invalid_amount");
    expect(code(() => toMinor("5", "inr", MAX_AMOUNT_MINOR))).toBe("invalid_currency");
    expect(code(() => assertMinor(1.5, 100))).toBe("invalid_amount");
    expect(code(() => assertMinor(Number.NaN, 100))).toBe("invalid_amount");
    expect(code(() => assertMinor(101, 100))).toBe("too_large");
  });
  it("formats minor units back for display, with currency exponent", () => {
    expect(fromMinor(123450, "INR")).toBe("1234.50");
    expect(fromMinor(5, "INR")).toBe("0.05");
    expect(fromMinor(0, "INR")).toBe("0.00");
    expect(fromMinor(7, "JPY")).toBe("7");
    expect(fromMinor(1234, "KWD")).toBe("1.234");
    expect(exponentOf("USD")).toBe(2);
  });
  it("converts a numeric(14,2) deal value without drift", () => {
    expect(majorToMinorRounded(1999.99, "INR", MAX_AMOUNT_MINOR)).toBe(199999);
    expect(majorToMinorRounded("250000.00", "INR", MAX_AMOUNT_MINOR)).toBe(25000000);
    expect(majorToMinorRounded(0.29, "INR", MAX_AMOUNT_MINOR)).toBe(29);
  });
});

describe("status transitions", () => {
  const all: PayStatus[] = ["created", "pending", "paid", "failed", "refunded", "cancelled"];
  it("moves forward and allows a retry after a failed attempt", () => {
    expect(canTransition("created", "paid")).toBe(true);
    expect(canTransition("pending", "paid")).toBe(true);
    expect(canTransition("failed", "paid")).toBe(true);
    expect(canTransition("paid", "refunded")).toBe(true);
    expect(canTransition("created", "cancelled")).toBe(true);
  });
  it("never moves backwards or out of a terminal state", () => {
    expect(canTransition("paid", "failed")).toBe(false);
    expect(canTransition("paid", "pending")).toBe(false);
    expect(canTransition("paid", "cancelled")).toBe(false);
    expect(canTransition("refunded", "paid")).toBe(false);
    expect(canTransition("cancelled", "paid")).toBe(false);
    for (const s of all) expect(canTransition(s, s)).toBe(false);
  });
});

describe("webhook parser (published payload schema)", () => {
  it("payment_link.paid carries link, order, payment ids, amounts and the CRM reference", () => {
    const [e] = parseWebhook(F.paymentLinkPaid());
    expect(e).toMatchObject({ kind: "payment", target: "paid", accountId: F.ACCOUNT, amount: 250000, amountPaid: 250000, currency: "INR", method: "upi", refs: { paymentLinkId: F.LINK, orderId: F.ORDER, paymentId: F.PAYMENT, crmPaymentId: F.CRM_PAYMENT } });
    expect(e.kind === "payment" && e.at).toBe(new Date(F.AT * 1000).toISOString());
  });
  it("payment.captured, authorized, failed (with the vendor error code) and partially_paid", () => {
    expect(parseWebhook(F.paymentCaptured())[0]).toMatchObject({ kind: "payment", target: "paid", refs: { orderId: F.ORDER, paymentId: F.PAYMENT } });
    expect(parseWebhook(F.paymentAuthorized())[0]).toMatchObject({ target: "pending" });
    expect(parseWebhook(F.paymentFailed())[0]).toMatchObject({ target: "failed", failure: { code: "BAD_REQUEST_ERROR" } });
    expect(parseWebhook(F.paymentLinkPartiallyPaid())[0]).toMatchObject({ target: "pending", amount: 250000, amountPaid: 100000 });
    expect(parseWebhook(F.paymentLinkExpired())[0]).toMatchObject({ target: "cancelled" });
  });
  it("refund events carry the refunded total from the payment entity", () => {
    expect(parseWebhook(F.refundProcessed({ refund: 100000, total: 100000 }))[0]).toMatchObject({ kind: "refund", refundStatus: "processed", refundAmount: 100000, paymentAmount: 250000, amountRefundedTotal: 100000, refs: { paymentId: F.PAYMENT } });
    expect(parseWebhook(F.refundCreated())[0]).toMatchObject({ kind: "refund", refundStatus: "created" });
    expect(parseWebhook(F.refundFailed())[0]).toMatchObject({ kind: "refund", refundStatus: "failed" });
  });
  it("unknown events are ignored, garbage and bodies without any reference give no events", () => {
    expect(parseWebhook(F.unknownEvent())).toEqual([expect.objectContaining({ kind: "ignored", event: "settlement.processed" })]);
    expect(parseWebhook(F.garbage)).toEqual([]);
    expect(parseWebhook("[]")).toEqual([]);
    expect(parseWebhook(JSON.stringify({ event: "payment.captured", payload: {} }))).toEqual([]);
  });
  it("event id: the vendor header, else a stable body hash", () => {
    expect(eventIdOf({ "x-razorpay-event-id": "evt_123" }, "{}")).toBe("evt_123");
    const a = eventIdOf({}, "{\"a\":1}"), b = eventIdOf(undefined, "{\"a\":1}");
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(parseWebhook(F.paymentCaptured(), { "x-razorpay-event-id": "evt_9" })[0].eventId).toBe("evt_9");
  });
});
