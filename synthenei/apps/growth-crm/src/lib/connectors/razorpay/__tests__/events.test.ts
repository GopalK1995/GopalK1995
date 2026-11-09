import { beforeEach, describe, expect, it } from "vitest";
import { handleEvent } from "../events";
import { parseWebhook } from "../payload";
import * as F from "../__fixtures__/payloads";
import { CONN, FakeStore, TENANT, WS, mkConn, mkDeps } from "./fake-store";
import type { ConnectionRow } from "../../core/types";

let st: FakeStore, rejects: string[];
const seed = (over: Record<string, unknown> = {}) => {
  st.payments.push({ id: F.CRM_PAYMENT, tenantId: TENANT, workspaceId: WS, integrationId: CONN, externalId: F.LINK, amountPaise: 250000, currency: "INR", status: "created", linkUrl: "mock://x", leadId: "lead-1", dealId: "deal-1", recordId: null, paidAt: null, rawRef: null, ...over });
  st.deals.push({ id: "deal-1", workspaceId: WS, name: "Booking", valueInr: 2500, leadId: "lead-1", stageId: "stage-open", pipelineId: "pipe-1" });
  st.stages = { booked: "stage-booked", open: "stage-open" };
};
const run = async (body: string, eventId: string, conn: ConnectionRow = mkConn({ settings: { paid_stage_key: "booked" } })) => {
  for (const evt of parseWebhook(body, { "x-razorpay-event-id": eventId })) await handleEvent({ deps: mkDeps(st), conn, secrets: {}, reject: (r) => rejects.push(r) }, evt);
};
const pay = () => st.payments[0];

beforeEach(() => { st = new FakeStore(); rejects = []; seed(); });

describe("payment_link.paid / payment.captured", () => {
  it("marks the payment paid, stamps paid_at from the vendor time, moves the deal and emits one audit event", async () => {
    await run(F.paymentLinkPaid(), "evt_1");
    expect(pay()).toMatchObject({ status: "paid", rawRef: "evt_1", paidAt: new Date(F.AT * 1000).toISOString() });
    expect(st.moves).toEqual([{ dealId: "deal-1", stageKey: "booked" }]);
    expect(st.events.map((e) => e.type)).toEqual(["payment.paid"]);
    expect(st.events[0].data).toMatchObject({ provider: "razorpay", amount_paise: 250000, currency: "INR", deal_id: "deal-1" });
    expect(rejects).toEqual([]);
  });
  it("matches by order id too (payment.captured after an order was created)", async () => {
    pay().externalId = F.ORDER;
    await run(F.paymentCaptured(), "evt_2");
    expect(pay().status).toBe("paid");
  });
  it("matches by the CRM reference note when the vendor ids are unknown", async () => {
    pay().externalId = null;
    await run(F.paymentCaptured(), "evt_3");
    expect(pay().status).toBe("paid");
  });
  it("is idempotent: the same event id again, and a second event for an already paid payment, change and emit nothing", async () => {
    await run(F.paymentLinkPaid(), "evt_1");
    const snapshot = JSON.stringify(pay()), events = st.events.length;
    await run(F.paymentLinkPaid(), "evt_1");
    await run(F.paymentCaptured(), "evt_other");   // same payment, different event id (vendor sends both link and payment events)
    expect(JSON.stringify(pay())).toBe(snapshot);
    expect(st.events.length).toBe(events);
    expect(st.moves.length).toBe(1);
  });
  it("does not move the deal when no paid stage is configured", async () => {
    await run(F.paymentLinkPaid(), "evt_1", mkConn());
    expect(pay().status).toBe("paid");
    expect(st.moves).toEqual([]);
  });
  it("a missing stage or a failing move never undoes the payment", async () => {
    st.stages = {};
    await run(F.paymentLinkPaid(), "evt_1");
    expect(pay().status).toBe("paid");
    expect(rejects).toContain("paid_stage_not_found");
    pay().status = "created"; pay().rawRef = null; st.stages = { booked: "s" }; st.failMove = true;
    await run(F.paymentCaptured(), "evt_2");
    expect(pay().status).toBe("paid");
    expect(rejects).toContain("deal_move_failed");
  });
  it("refuses an amount or currency that differs from the stored payment and says so, never marking it paid", async () => {
    await run(F.paymentCaptured({ amount: 100 }), "evt_1");
    await run(F.paymentCaptured({ currency: "USD" }), "evt_2");
    expect(pay().status).toBe("created");
    expect(rejects).toEqual(["amount_mismatch", "amount_mismatch"]);
    expect(st.events.map((e) => e.type)).toEqual(["payment.mismatch", "payment.mismatch"]);
    expect(st.moves).toEqual([]);
  });
});

describe("failed, partial, expired", () => {
  it("failed is recorded with the vendor code and does not block a later successful retry", async () => {
    await run(F.paymentFailed(), "evt_f");
    expect(pay()).toMatchObject({ status: "failed", failureCode: "BAD_REQUEST_ERROR" });
    expect(st.events.map((e) => e.type)).toEqual(["payment.failed"]);
    await run(F.paymentCaptured(), "evt_ok");
    expect(pay().status).toBe("paid");
  });
  it("a failure that arrives after payment is ignored", async () => {
    await run(F.paymentCaptured(), "evt_ok");
    await run(F.paymentFailed(), "evt_late");
    expect(pay().status).toBe("paid");
    expect(st.events.map((e) => e.type)).toEqual(["payment.paid"]);
  });
  it("authorised / partly paid is stored as pending without an announcement; expiry cancels an open link only", async () => {
    await run(F.paymentLinkPartiallyPaid(), "evt_p");
    expect(pay().status).toBe("pending");
    expect(st.events).toEqual([]);
    await run(F.paymentLinkExpired(), "evt_x");
    expect(pay().status).toBe("cancelled");
    expect(st.events.map((e) => e.type)).toEqual(["payment.cancelled"]);
    await run(F.paymentCaptured(), "evt_late_paid");   // a cancelled link cannot be paid
    expect(pay().status).toBe("cancelled");
  });
});

describe("refunds", () => {
  beforeEach(async () => { await run(F.paymentCaptured(), "evt_paid"); st.events.length = 0; });
  it("a full processed refund marks the payment refunded", async () => {
    await run(F.refundProcessed(), "evt_r1");
    expect(pay()).toMatchObject({ status: "refunded", refundedPaise: 250000 });
    expect(st.events.map((e) => e.type)).toEqual(["payment.refunded"]);
  });
  it("a partial refund keeps the payment paid, records the refunded total and announces it", async () => {
    await run(F.refundProcessed({ refund: 50000, total: 50000 }), "evt_r2");
    expect(pay()).toMatchObject({ status: "paid", refundedPaise: 50000 });
    expect(st.events.map((e) => e.type)).toEqual(["payment.refund_partial"]);
    await run(F.refundProcessed({ refund: 200000, total: 250000 }), "evt_r3");   // the rest later: now full
    expect(pay().status).toBe("refunded");
  });
  it("created and failed refunds change nothing", async () => {
    await run(F.refundCreated(), "evt_r4");
    await run(F.refundFailed(), "evt_r5");
    expect(pay().status).toBe("paid");
    expect(st.events).toEqual([]);
  });
});

describe("tenant isolation", () => {
  it("never finds a payment of another workspace, even with the right vendor id", async () => {
    await run(F.paymentLinkPaid(), "evt_1", mkConn({ workspaceId: "ws-other", tenantId: "t-other" }));
    expect(pay().status).toBe("created");
    expect(rejects).toEqual(["unknown_payment"]);
  });
  it("refuses a payment that belongs to another connection of the same workspace", async () => {
    await run(F.paymentLinkPaid(), "evt_1", mkConn({ id: "conn-2" }));
    expect(pay().status).toBe("created");
    expect(rejects).toEqual(["other_connection"]);
  });
  it("refuses an event for another Razorpay account when the connection stores its account id", async () => {
    const conn = mkConn({ settings: { account_id: F.ACCOUNT } });
    await run(F.paymentCaptured({ account: F.OTHER_ACCOUNT }), "evt_1", conn);
    expect(pay().status).toBe("created");
    expect(rejects).toEqual(["account_mismatch"]);
    await run(F.paymentCaptured(), "evt_2", conn);
    expect(pay().status).toBe("paid");
  });
  it("an unknown payment is rejected, an unrelated event type is ignored silently", async () => {
    await run(F.paymentCaptured({ link: "plink_nope", order: "order_nope", payment: "pay_nope", crmPayment: null }), "evt_1");
    expect(rejects).toEqual(["unknown_payment"]);
    rejects.length = 0;
    await run(F.unknownEvent(), "evt_2");
    expect(rejects).toEqual([]);
  });
});
