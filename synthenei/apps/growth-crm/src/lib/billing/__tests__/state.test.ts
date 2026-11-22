import { describe, expect, it } from "vitest";
import { applyBilling, canAddSeat, orgState, READONLY_SINCE, seatLimit, seatStatus, TRIAL_WARN_DAYS } from "../state";
import type { SubscriptionRow, TenantRow } from "../types";

const NOW = new Date("2026-06-15T00:00:00.000Z");
const tenant = (over: Partial<TenantRow> = {}): TenantRow => ({ id: "t-1", slug: "lawsome", name: "LAWSOME", status: "active", trialEndsAt: null, ...over });
const sub = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  tenantId: "t-1", planId: "trial", status: "trial", seats: null, trialEndsAt: null, currentPeriodEnd: null,
  provider: null, providerSubscriptionId: null, gstin: null, billingAddress: null, ...over,
});

describe("orgState", () => {
  it("a non-active tenant is suspended regardless of subscription", () => {
    expect(orgState({ tenant: tenant({ status: "suspended" }), sub: sub({ status: "active" }), now: NOW })).toMatchObject({ mode: "suspended", reason: "suspended" });
  });
  it("no subscription, or a manual plan, is always ok", () => {
    expect(orgState({ tenant: tenant(), sub: null, now: NOW })).toMatchObject({ mode: "ok" });
    expect(orgState({ tenant: tenant(), sub: sub({ status: "manual" }), now: NOW })).toMatchObject({ mode: "ok" });
  });
  it("trial: ok with days left and a warning inside the window, readonly once it ends", () => {
    const warning = orgState({ tenant: tenant(), sub: sub({ trialEndsAt: "2026-06-17T00:00:00.000Z" }), now: NOW });
    expect(warning).toMatchObject({ mode: "ok", daysLeft: 2, warn: "trial_ending" });
    expect(2).toBeLessThanOrEqual(TRIAL_WARN_DAYS);
    const fresh = orgState({ tenant: tenant(), sub: sub({ trialEndsAt: "2026-07-01T00:00:00.000Z" }), now: NOW });
    expect(fresh).toMatchObject({ mode: "ok", warn: null });
    const ended = orgState({ tenant: tenant(), sub: sub({ trialEndsAt: "2026-06-01T00:00:00.000Z" }), now: NOW });
    expect(ended).toMatchObject({ mode: "readonly", reason: "trial_ended", daysLeft: 0 });
  });
  it("trial end falls back to the tenant row when the subscription has none", () => {
    const r = orgState({ tenant: tenant({ trialEndsAt: "2026-06-01T00:00:00.000Z" }), sub: sub({ trialEndsAt: null }), now: NOW });
    expect(r).toMatchObject({ mode: "readonly", reason: "trial_ended" });
  });
  it("cancelled: ok until the paid period ends, then readonly", () => {
    expect(orgState({ tenant: tenant(), sub: sub({ status: "cancelled", currentPeriodEnd: "2026-07-01T00:00:00.000Z" }), now: NOW })).toMatchObject({ mode: "ok" });
    expect(orgState({ tenant: tenant(), sub: sub({ status: "cancelled", currentPeriodEnd: "2026-06-01T00:00:00.000Z" }), now: NOW })).toMatchObject({ mode: "readonly", reason: "cancelled" });
    expect(orgState({ tenant: tenant(), sub: sub({ status: "cancelled", currentPeriodEnd: null }), now: NOW })).toMatchObject({ mode: "readonly", reason: "cancelled" });
  });
  it("past_due: warns inside the grace period, readonly past it; unset grace never enforces", () => {
    const base = sub({ status: "past_due", currentPeriodEnd: "2026-06-10T00:00:00.000Z" });
    expect(orgState({ tenant: tenant(), sub: base, now: NOW, graceDays: 7 })).toMatchObject({ mode: "ok", warn: "past_due" });
    expect(orgState({ tenant: tenant(), sub: base, now: NOW, graceDays: 3 })).toMatchObject({ mode: "readonly", reason: "past_due" });
    expect(orgState({ tenant: tenant(), sub: base, now: NOW, graceDays: null })).toMatchObject({ mode: "ok", warn: "past_due" });
  });
});

describe("seats", () => {
  it("effective limit is the lower of the plan limit and purchased seats; absent is unlimited", () => {
    expect(seatLimit({ seats: 10 }, 5)).toBe(5);
    expect(seatLimit({ seats: 10 }, null)).toBe(10);
    expect(seatLimit({}, null)).toBeNull();
    expect(seatLimit({}, 5)).toBe(5);
  });
  it("status reports remaining, at-limit and over", () => {
    expect(seatStatus(5, 5)).toMatchObject({ remaining: 0, atLimit: true, over: false });
    expect(seatStatus(6, 5)).toMatchObject({ remaining: 0, atLimit: true, over: true });
    expect(seatStatus(3, 5)).toMatchObject({ remaining: 2, atLimit: false, over: false });
    expect(seatStatus(3, null)).toMatchObject({ remaining: null, atLimit: false, over: false });
  });
  it("an invite is blocked only at the cap, unless the invitee already holds a seat", () => {
    const full = seatStatus(5, 5);
    expect(canAddSeat(full)).toBe(false);
    expect(canAddSeat(full, true)).toBe(true);
    expect(canAddSeat(seatStatus(3, 5))).toBe(true);
  });
});

describe("applyBilling", () => {
  it("suspended mode overrides the principal's tenant status", () => {
    const p = applyBilling({ tenantId: "t-1", tenant: { status: "active" }, capped: [] } as never, { org: { mode: "suspended", reason: "suspended", trialEndsAt: null, daysLeft: null, warn: null }, seats: seatStatus(0, null) });
    expect(p.tenant).toEqual({ status: "suspended" });
  });
  it("readonly mode marks the tenant as an expired trial, unless already suspended", () => {
    const p = applyBilling({ tenantId: "t-1", tenant: { status: "active" }, capped: [] } as never, { org: { mode: "readonly", reason: "trial_ended", trialEndsAt: null, daysLeft: 0, warn: null }, seats: seatStatus(0, null) });
    expect(p.tenant).toEqual({ status: "trial", trialEndsAt: READONLY_SINCE });
    const already = applyBilling({ tenantId: "t-1", tenant: { status: "suspended" }, capped: [] } as never, { org: { mode: "readonly", reason: "trial_ended", trialEndsAt: null, daysLeft: 0, warn: null }, seats: seatStatus(0, null) });
    expect(already.tenant).toEqual({ status: "suspended" });
  });
  it("a full seat count adds members.invite to capped without dropping existing caps", () => {
    const p = applyBilling({ tenantId: "t-1", tenant: { status: "active" }, capped: ["ai.use"] } as never, { org: { mode: "ok", reason: null, trialEndsAt: null, daysLeft: null, warn: null }, seats: seatStatus(5, 5) });
    expect(p.capped).toEqual(["ai.use", "members.invite"]);
  });
  it("ok mode with seats free leaves the principal untouched", () => {
    const p = applyBilling({ tenantId: "t-1", tenant: { status: "active" }, capped: [] } as never, { org: { mode: "ok", reason: null, trialEndsAt: null, daysLeft: null, warn: null }, seats: seatStatus(1, 5) });
    expect(p.tenant).toEqual({ status: "active" });
    expect(p.capped).toEqual([]);
  });
});
