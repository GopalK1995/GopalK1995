import { describe, expect, it } from "vitest";
import {
  adminSavePlan, adminSetSubscription, cancelSubscription, createManualInvoice, handleWebhook, invoicePdf,
  setInvoiceStatus, snapshot, startSubscription, updateBillingDetails,
} from "../service";
import { memoryBillingStore } from "../memory-store";
import type { PlanRow, SubscriptionRow, TenantRow } from "../types";
import { createHmac } from "node:crypto";

const ISSUER_ENV = { BILLING_GSTIN: "33AAAAA0000A1Z5", BILLING_SAC_CODE: "998314", BILLING_GST_RATE_PERCENT: "18", BILLING_LEGAL_NAME: "Synthenei Technologies" };
const RZP_ENV = { RAZORPAY_KEY_ID: "rzp_test_abc123", RAZORPAY_KEY_SECRET: "sekrit", RAZORPAY_WEBHOOK_SECRET: "whsec" };
const FULL_ENV = { ...ISSUER_ENV, ...RZP_ENV };

function setup(env: Record<string, string | undefined> = FULL_ENV) {
  const store = memoryBillingStore();
  const audited: { action: string; detail?: Record<string, unknown> }[] = [];
  const deps = { store, env, now: () => new Date("2026-06-15T00:00:00.000Z"), audit: async (l: { action: string; detail?: Record<string, unknown> }) => { audited.push(l); } };
  return { store, deps, audited };
}
const mkTenant = (over: Partial<TenantRow> = {}): TenantRow => ({ id: "t-1", slug: "lawsome", name: "LAWSOME", status: "active", trialEndsAt: null, ...over });
const mkSub = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  tenantId: "t-1", planId: "trial", status: "trial", seats: null, trialEndsAt: null, currentPeriodEnd: null,
  provider: null, providerSubscriptionId: null, gstin: null, billingAddress: null, ...over,
});
const mkPlan = (over: Partial<PlanRow> = {}): PlanRow => ({ id: "pro", name: "Pro", pricePaiseMonthly: 100000, pricePaiseYearly: 1000000, limits: { seats: 5 }, modules: [], isPublic: true, providerPlanIds: {}, ...over });

describe("snapshot", () => {
  it("null for an unknown tenant", async () => {
    const { deps } = setup();
    expect(await snapshot(deps, "nope")).toBeNull();
  });
  it("combines tenant, subscription, plan and seat state", async () => {
    const { store, deps } = setup();
    store.state.tenants.set("t-1", mkTenant());
    store.state.subs.set("t-1", mkSub({ planId: "pro", status: "active" }));
    store.state.plans.set("pro", mkPlan());
    store.state.seats.set("t-1", 3);
    const s = await snapshot(deps, "t-1");
    expect(s).toMatchObject({ seats: { used: 3, limit: 5, remaining: 2 }, org: { mode: "ok" } });
  });
});

describe("startSubscription", () => {
  it("fails when there is no subscription row, the plan is unavailable, or price is zero", async () => {
    const { store, deps } = setup();
    expect(await startSubscription(deps, { tenantId: "t-1", planId: "pro", interval: "monthly", actor: "u1" })).toMatchObject({ ok: false, code: "no_subscription" });
    store.state.subs.set("t-1", mkSub());
    expect(await startSubscription(deps, { tenantId: "t-1", planId: "pro", interval: "monthly", actor: "u1" })).toMatchObject({ ok: false, code: "plan_unavailable" });
    store.state.plans.set("pro", mkPlan({ isPublic: false }));
    expect(await startSubscription(deps, { tenantId: "t-1", planId: "pro", interval: "monthly", actor: "u1" })).toMatchObject({ ok: false, code: "plan_unavailable" });
    store.state.plans.set("pro", mkPlan({ pricePaiseMonthly: 0 }));
    expect(await startSubscription(deps, { tenantId: "t-1", planId: "pro", interval: "monthly", actor: "u1" })).toMatchObject({ ok: false, code: "price_not_set" });
  });
  it("already_active when the tenant already holds that plan and is active", async () => {
    const { store, deps } = setup();
    store.state.subs.set("t-1", mkSub({ status: "active", planId: "pro" }));
    store.state.plans.set("pro", mkPlan());
    expect(await startSubscription(deps, { tenantId: "t-1", planId: "pro", interval: "monthly", actor: "u1" })).toMatchObject({ ok: false, code: "already_active" });
  });
  it("refuses without issuer or Razorpay config", async () => {
    const { store, deps } = setup({});
    store.state.subs.set("t-1", mkSub());
    store.state.plans.set("pro", mkPlan());
    expect(await startSubscription(deps, { tenantId: "t-1", planId: "pro", interval: "monthly", actor: "u1" })).toMatchObject({ ok: false, code: "issuer_unconfigured" });
    expect(await startSubscription({ ...deps, env: ISSUER_ENV }, { tenantId: "t-1", planId: "pro", interval: "monthly", actor: "u1" })).toMatchObject({ ok: false, code: "razorpay_unconfigured" });
  });
  it("creates a Razorpay plan and subscription in test mode, records the provider id and audits", async () => {
    const { store, deps, audited } = setup();
    store.state.subs.set("t-1", mkSub());
    store.state.plans.set("pro", mkPlan());
    const fetchImpl = (async (url: string) => {
      const u = String(url);
      const body = u.includes("/plans") ? { id: "plan_rzp_1" } : { id: "sub_rzp_1", status: "created", short_url: "https://rzp.io/i/abc" };
      return { ok: true, text: async () => JSON.stringify(body) } as Response;
    }) as typeof fetch;
    const r = await startSubscription({ ...deps, fetchImpl }, { tenantId: "t-1", planId: "pro", interval: "monthly", actor: "u1" });
    expect(r).toMatchObject({ ok: true, data: { subscriptionId: "sub_rzp_1", mode: "test", url: "https://rzp.io/i/abc" } });
    expect(store.state.plans.get("pro")?.providerPlanIds.monthly).toBe("plan_rzp_1");
    expect(store.state.subs.get("t-1")).toMatchObject({ provider: "razorpay", providerSubscriptionId: "sub_rzp_1" });
    expect(audited.map((a) => a.action)).toContain("billing.subscription_started");
  });
  it("surfaces a Razorpay API error as razorpay_error", async () => {
    const { store, deps } = setup();
    store.state.subs.set("t-1", mkSub());
    store.state.plans.set("pro", mkPlan());
    const fetchImpl = (async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: { description: "bad request" } }) } as Response)) as typeof fetch;
    expect(await startSubscription({ ...deps, fetchImpl }, { tenantId: "t-1", planId: "pro", interval: "monthly", actor: "u1" })).toMatchObject({ ok: false, code: "razorpay_error", detail: "bad request" });
  });
});

describe("cancelSubscription", () => {
  it("no_provider_subscription when there is nothing to cancel", async () => {
    const { store, deps } = setup();
    store.state.subs.set("t-1", mkSub());
    expect(await cancelSubscription(deps, { tenantId: "t-1" })).toMatchObject({ ok: false, code: "no_provider_subscription" });
  });
  it("cancels at Razorpay and audits, without changing local status (the webhook does that)", async () => {
    const { store, deps, audited } = setup();
    store.state.subs.set("t-1", mkSub({ status: "active", provider: "razorpay", providerSubscriptionId: "sub_rzp_1" }));
    const calls: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => { calls.push(JSON.parse(String(init?.body))); return { ok: true, text: async () => JSON.stringify({ id: "sub_rzp_1", status: "cancelled" }) } as Response; }) as typeof fetch;
    const r = await cancelSubscription({ ...deps, fetchImpl }, { tenantId: "t-1" });
    expect(r).toMatchObject({ ok: true });
    expect(calls).toEqual([{ cancel_at_cycle_end: 1 }]);
    expect(store.state.subs.get("t-1")?.status).toBe("active");
    expect(audited.map((a) => a.action)).toContain("billing.subscription_cancel_requested");
  });
});

describe("updateBillingDetails", () => {
  it("rejects a malformed GSTIN and a missing subscription", async () => {
    const { store, deps } = setup();
    store.state.subs.set("t-1", mkSub());
    expect(await updateBillingDetails(deps, { tenantId: "t-1", gstin: "not-a-gstin" })).toMatchObject({ ok: false, code: "bad_gstin" });
    expect(await updateBillingDetails(deps, { tenantId: "nope", gstin: null })).toMatchObject({ ok: false, code: "no_subscription" });
  });
  it("uppercases and stores a valid GSTIN plus the address", async () => {
    const { store, deps } = setup();
    store.state.subs.set("t-1", mkSub());
    const r = await updateBillingDetails(deps, { tenantId: "t-1", gstin: "33aaaaa0000a1z5", address: { name: "LAWSOME", stateCode: "33" } });
    expect(r).toMatchObject({ ok: true });
    expect(store.state.subs.get("t-1")).toMatchObject({ gstin: "33AAAAA0000A1Z5", billingAddress: { name: "LAWSOME", stateCode: "33" } });
  });
});

describe("handleWebhook", () => {
  const sign = (body: string) => createHmac("sha256", "whsec").update(body, "utf8").digest("hex");
  const body = (ev: Record<string, unknown>) => JSON.stringify(ev);

  it("rejects a bad signature or unparsable body", async () => {
    const { deps } = setup();
    const b = body({ event: "subscription.activated" });
    expect(await handleWebhook(deps, b, "wrong-sig")).toMatchObject({ ok: false, code: "bad_signature" });
    expect(await handleWebhook(deps, "{not json", sign("{not json"))).toMatchObject({ ok: false, code: "bad_body" });
  });
  it("ignores events with no mapped subscription, and unknown subscriptions whose signature is still valid", async () => {
    const { store, deps } = setup();
    const unmapped = body({ event: "payment.captured", payload: {} });
    expect(await handleWebhook(deps, unmapped, sign(unmapped))).toMatchObject({ ok: true, data: "ignored" });
    store.state.subs.set("t-1", mkSub({ providerSubscriptionId: "sub_other" }));
    const foreign = body({ event: "subscription.activated", payload: { subscription: { entity: { id: "sub_rzp_1", notes: { tenant_id: "t-1", plan_id: "pro" } } } } });
    expect(await handleWebhook(deps, foreign, sign(foreign))).toMatchObject({ ok: true, data: "unknown_subscription" });
  });
  it("activates the subscription and swaps the plan on subscription.activated", async () => {
    const { store, deps } = setup();
    store.state.subs.set("t-1", mkSub({ status: "trial", providerSubscriptionId: "sub_rzp_1", planId: "trial" }));
    store.state.plans.set("pro", mkPlan());
    const end = Math.floor(Date.parse("2026-07-15T00:00:00.000Z") / 1000);
    const b = body({ event: "subscription.activated", payload: { subscription: { entity: { id: "sub_rzp_1", current_end: end, notes: { tenant_id: "t-1", plan_id: "pro" } } } } });
    const r = await handleWebhook(deps, b, sign(b));
    expect(r).toMatchObject({ ok: true, data: "applied" });
    expect(store.state.subs.get("t-1")).toMatchObject({ status: "active", planId: "pro", currentPeriodEnd: "2026-07-15T00:00:00.000Z" });
  });
  it("records exactly one invoice per billing period on subscription.charged, even if the webhook is redelivered", async () => {
    const { store, deps } = setup();
    store.state.subs.set("t-1", mkSub({ status: "active", providerSubscriptionId: "sub_rzp_1", planId: "pro" }));
    store.state.plans.set("pro", mkPlan());
    const end = Math.floor(Date.parse("2026-07-15T00:00:00.000Z") / 1000);
    const b = body({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_rzp_1", current_end: end, notes: { tenant_id: "t-1", plan_id: "pro" } } }, payment: { entity: { id: "pay_1", amount: 118000 } } } });
    await handleWebhook(deps, b, sign(b));
    await handleWebhook(deps, b, sign(b)); // redelivery
    const invoices = await store.listInvoices("t-1");
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ status: "paid" });
  });
  it("marks past_due on pending/halted and cancelled on cancelled/completed", async () => {
    const { store, deps } = setup();
    store.state.subs.set("t-1", mkSub({ status: "active", providerSubscriptionId: "sub_rzp_1" }));
    const b = body({ event: "subscription.pending", payload: { subscription: { entity: { id: "sub_rzp_1", notes: { tenant_id: "t-1" } } } } });
    await handleWebhook(deps, b, sign(b));
    expect(store.state.subs.get("t-1")?.status).toBe("past_due");
    const c = body({ event: "subscription.cancelled", payload: { subscription: { entity: { id: "sub_rzp_1", notes: { tenant_id: "t-1" } } } } });
    await handleWebhook(deps, c, sign(c));
    expect(store.state.subs.get("t-1")?.status).toBe("cancelled");
  });
});

describe("manual invoices", () => {
  it("validates period, amount and duplicate periods", async () => {
    const { store, deps } = setup();
    store.state.subs.set("t-1", mkSub());
    expect(await createManualInvoice(deps, { tenantId: "t-1", periodStart: "bad", periodEnd: "2026-07-01", amountPaise: 100 })).toMatchObject({ ok: false, code: "bad_period" });
    expect(await createManualInvoice(deps, { tenantId: "t-1", periodStart: "2026-07-01", periodEnd: "2026-06-01", amountPaise: 100 })).toMatchObject({ ok: false, code: "bad_period" });
    expect(await createManualInvoice(deps, { tenantId: "t-1", periodStart: "2026-06-01", periodEnd: "2026-07-01", amountPaise: -1 })).toMatchObject({ ok: false, code: "bad_amount" });
    const first = await createManualInvoice(deps, { tenantId: "t-1", periodStart: "2026-06-01", periodEnd: "2026-07-01", amountPaise: 100000, issue: true });
    expect(first).toMatchObject({ ok: true, data: { status: "issued" } });
    expect(await createManualInvoice(deps, { tenantId: "t-1", periodStart: "2026-06-01", periodEnd: "2026-07-01", amountPaise: 100000 })).toMatchObject({ ok: false, code: "duplicate_period" });
  });
  it("draft by default; status only moves forward and void is final", async () => {
    const { store, deps } = setup();
    store.state.subs.set("t-1", mkSub());
    const inv = await createManualInvoice(deps, { tenantId: "t-1", periodStart: "2026-06-01", periodEnd: "2026-07-01", amountPaise: 100000 });
    expect(inv).toMatchObject({ ok: true, data: { status: "draft" } });
    const id = (inv as { ok: true; data: { id: string } }).data.id;
    expect(await setInvoiceStatus(deps, { id, to: "paid" })).toMatchObject({ ok: false, code: "bad_transition" });
    expect(await setInvoiceStatus(deps, { id, to: "issued" })).toMatchObject({ ok: true });
    expect(await setInvoiceStatus(deps, { id, to: "void" })).toMatchObject({ ok: true });
    expect(await setInvoiceStatus(deps, { id, to: "paid" })).toMatchObject({ ok: false, code: "bad_transition" });
    expect(await setInvoiceStatus(deps, { id: "nope", to: "paid" })).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("invoicePdf", () => {
  it("hides drafts from the customer, scopes by tenant, and renders a PDF for the rest", async () => {
    const { store, deps } = setup();
    store.state.tenants.set("t-1", mkTenant());
    store.state.subs.set("t-1", mkSub());
    const inv = await createManualInvoice(deps, { tenantId: "t-1", periodStart: "2026-06-01", periodEnd: "2026-07-01", amountPaise: 100000, issue: true });
    const id = (inv as { ok: true; data: { id: string } }).data.id;
    expect(await invoicePdf(deps, id, "other-tenant")).toMatchObject({ ok: false, code: "not_found" });
    const r = await invoicePdf(deps, id, "t-1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Buffer.from(r.data.bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
      expect(r.data.filename).toMatch(/\.pdf$/);
    }
  });
});

describe("platform admin", () => {
  it("adminSetSubscription requires a reason and validates plan, seats and dates", async () => {
    const { store, deps, audited } = setup();
    store.state.subs.set("t-1", mkSub());
    expect(await adminSetSubscription(deps, { tenantId: "t-1", reason: "short" })).toMatchObject({ ok: false, code: "reason_required" });
    expect(await adminSetSubscription(deps, { tenantId: "t-1", reason: "support ticket 123", planId: "ghost" })).toMatchObject({ ok: false, code: "unknown_plan" });
    expect(await adminSetSubscription(deps, { tenantId: "t-1", reason: "support ticket 123", seats: -1 })).toMatchObject({ ok: false, code: "bad_value" });
    store.state.plans.set("pro", mkPlan());
    const r = await adminSetSubscription(deps, { tenantId: "t-1", reason: "support ticket 123", planId: "pro", status: "active", seats: 10 });
    expect(r).toMatchObject({ ok: true });
    expect(store.state.subs.get("t-1")).toMatchObject({ planId: "pro", status: "active", seats: 10 });
    expect(audited.find((a) => a.action === "billing.subscription_set")?.detail).toMatchObject({ reason: "support ticket 123" });
  });
  it("adminSavePlan validates the id, name and non-negative integer prices", async () => {
    const { store, deps } = setup();
    expect(await adminSavePlan(deps, { ...mkPlan(), id: "Bad Id" })).toMatchObject({ ok: false, code: "bad_value" });
    expect(await adminSavePlan(deps, { ...mkPlan(), pricePaiseMonthly: -1 })).toMatchObject({ ok: false, code: "bad_value" });
    expect(await adminSavePlan(deps, mkPlan())).toMatchObject({ ok: true });
    expect(store.state.plans.get("pro")).toMatchObject({ name: "Pro", isPublic: true });
  });
});
