import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapSubscriptionEvent, verifyWebhook } from "../razorpay";

const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body, "utf8").digest("hex");

describe("verifyWebhook", () => {
  it("accepts a matching HMAC-SHA256 signature", () => {
    const body = JSON.stringify({ event: "subscription.activated" });
    expect(verifyWebhook("secret", body, sign("secret", body))).toBe(true);
  });
  it("rejects a wrong secret, a tampered body, a missing signature or an unconfigured secret", () => {
    const body = JSON.stringify({ event: "subscription.activated" });
    expect(verifyWebhook("secret", body, sign("other", body))).toBe(false);
    expect(verifyWebhook("secret", body + "x", sign("secret", body))).toBe(false);
    expect(verifyWebhook("secret", body, null)).toBe(false);
    expect(verifyWebhook(undefined, body, sign("secret", body))).toBe(false);
  });
});

describe("mapSubscriptionEvent", () => {
  const sub = (over: Record<string, unknown> = {}) => ({ id: "sub_1", status: "active", current_end: 1_750_000_000, notes: { tenant_id: "t-1", plan_id: "pro" }, ...over });
  it("maps activated and charged events, carrying tenant, plan and period end", () => {
    const activated = mapSubscriptionEvent({ event: "subscription.activated", payload: { subscription: { entity: sub() } } });
    expect(activated).toMatchObject({ kind: "activated", subscriptionId: "sub_1", tenantId: "t-1", appPlanId: "pro", currentEnd: new Date(1_750_000_000 * 1000).toISOString() });
    const charged = mapSubscriptionEvent({ event: "subscription.charged", payload: { subscription: { entity: sub() }, payment: { entity: { id: "pay_1", amount: 11800 } } } });
    expect(charged).toMatchObject({ kind: "charged", paymentId: "pay_1", amountPaise: 11800 });
  });
  it("maps pending/halted to past_due and cancelled/completed to cancelled", () => {
    expect(mapSubscriptionEvent({ event: "subscription.pending", payload: { subscription: { entity: sub() } } })).toMatchObject({ kind: "past_due" });
    expect(mapSubscriptionEvent({ event: "subscription.halted", payload: { subscription: { entity: sub() } } })).toMatchObject({ kind: "past_due" });
    expect(mapSubscriptionEvent({ event: "subscription.cancelled", payload: { subscription: { entity: sub() } } })).toMatchObject({ kind: "cancelled" });
    expect(mapSubscriptionEvent({ event: "subscription.completed", payload: { subscription: { entity: sub() } } })).toMatchObject({ kind: "cancelled" });
  });
  it("ignores unknown events, bodies with no subscription id, and garbage", () => {
    expect(mapSubscriptionEvent({ event: "payment.captured", payload: {} })).toEqual({ kind: "ignore" });
    expect(mapSubscriptionEvent({ event: "subscription.activated", payload: {} })).toEqual({ kind: "ignore" });
    expect(mapSubscriptionEvent(null)).toEqual({ kind: "ignore" });
    expect(mapSubscriptionEvent("not an object")).toEqual({ kind: "ignore" });
  });
  it("a subscription with no tenant_id note maps with tenantId null", () => {
    const r = mapSubscriptionEvent({ event: "subscription.activated", payload: { subscription: { entity: sub({ notes: {} }) } } });
    expect(r).toMatchObject({ tenantId: null, appPlanId: null });
  });
});
