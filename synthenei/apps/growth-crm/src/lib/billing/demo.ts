// Demo sessions: seed the in-memory store with the signed-in demo organisation (trial, no prices). Pure over the store port.
import type { BillingStore } from "./store";
import type { MemoryState } from "./memory-store";

export async function ensureDemoTenant(store: BillingStore, tenantId: string, name: string): Promise<void> {
  const m = (store as unknown as { state?: MemoryState }).state;
  if (!m || m.tenants.has(tenantId)) return;
  const ends = new Date(Date.now() + 14 * 86_400_000).toISOString();
  m.tenants.set(tenantId, { id: tenantId, slug: tenantId, name, status: "active", trialEndsAt: ends });
  m.subs.set(tenantId, { tenantId, planId: "trial", status: "trial", seats: null, trialEndsAt: ends, currentPeriodEnd: null, provider: null, providerSubscriptionId: null, gstin: null, billingAddress: null });
  m.seats.set(tenantId, 3);
}
