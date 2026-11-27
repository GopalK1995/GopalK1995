// Demo sessions: seed the in-memory store with the signed-in demo organisation (trial, no prices). Pure over the store port.
import type { BillingStore } from "./store";
import type { MemoryState } from "./memory-store";

/** `seed` lets the platform console make the demo subscription agree with the demo tenancy (one plan/seat story across Overview and Billing). */
export interface DemoSeed { planName: string; seats: number; used: number }
export async function ensureDemoTenant(store: BillingStore, tenantId: string, name: string, seed?: DemoSeed): Promise<void> {
  const m = (store as unknown as { state?: MemoryState }).state;
  if (!m || m.tenants.has(tenantId)) return;
  const ends = new Date(Date.now() + 14 * 86_400_000).toISOString();
  if (seed) {
    const planId = seed.planName.toLowerCase();
    if (!m.plans.has(planId)) m.plans.set(planId, { id: planId, name: seed.planName, pricePaiseMonthly: 0, pricePaiseYearly: 0, limits: { seats: seed.seats }, modules: [], isPublic: false, providerPlanIds: {} });
    m.tenants.set(tenantId, { id: tenantId, slug: tenantId, name, status: "active", trialEndsAt: null });
    m.subs.set(tenantId, { tenantId, planId, status: "manual", seats: seed.seats, trialEndsAt: null, currentPeriodEnd: null, provider: null, providerSubscriptionId: null, gstin: null, billingAddress: null });
    m.seats.set(tenantId, seed.used);
    return;
  }
  m.tenants.set(tenantId, { id: tenantId, slug: tenantId, name, status: "active", trialEndsAt: ends });
  m.subs.set(tenantId, { tenantId, planId: "trial", status: "trial", seats: null, trialEndsAt: ends, currentPeriodEnd: null, provider: null, providerSubscriptionId: null, gstin: null, billingAddress: null });
  m.seats.set(tenantId, 3);
}
