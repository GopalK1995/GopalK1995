// In-memory BillingStore: Vitest fixtures and demo sessions (nothing persists across a server restart). No prices or plan names beyond the two
// system plans the migration seeds ("trial", "manual"); callers add their own.
import type { BillingStore, Entitlements, SubscriptionPatch } from "./store";
import type { Interval, InvoiceRow, InvoiceStatus, NewInvoice, PlanRow, SubscriptionRow, TenantRow } from "./types";

export interface MemoryState {
  tenants: Map<string, TenantRow>; subs: Map<string, SubscriptionRow>; plans: Map<string, PlanRow>; invoices: Map<string, InvoiceRow>;
  seats: Map<string, number>; usage: Map<string, Record<string, number>>; policyLimits: Map<string, Record<string, number>>;
}
export function memoryState(): MemoryState {
  const plans = new Map<string, PlanRow>();
  for (const [id, name, limits] of [["trial", "Trial", { seats: 5, workspaces: 1 }], ["manual", "Manual (invoiced)", {}]] as const)
    plans.set(id, { id, name, pricePaiseMonthly: 0, pricePaiseYearly: 0, limits: { ...limits }, modules: [], isPublic: false, providerPlanIds: {} });
  return { tenants: new Map(), subs: new Map(), plans, invoices: new Map(), seats: new Map(), usage: new Map(), policyLimits: new Map() };
}

export function memoryBillingStore(m: MemoryState = memoryState()): BillingStore & { state: MemoryState } {
  let seq = 0;
  return {
    state: m,
    async getTenant(id) { return m.tenants.get(id) ?? null; },
    async listTenants() { return [...m.tenants.values()]; },
    async getSubscription(t) { return m.subs.get(t) ?? null; },
    async listSubscriptions() { return [...m.subs.values()]; },
    async patchSubscription(t, patch: SubscriptionPatch) {
      const cur = m.subs.get(t); if (!cur) throw new Error("no subscription");
      const next = { ...cur }; for (const [k, v] of Object.entries(patch)) if (v !== undefined) (next as Record<string, unknown>)[k] = v;
      m.subs.set(t, next);
    },
    async listPlans() { return [...m.plans.values()]; },
    async getPlan(id) { return m.plans.get(id) ?? null; },
    async savePlan(p) { m.plans.set(p.id, { ...p, providerPlanIds: m.plans.get(p.id)?.providerPlanIds ?? {} }); },
    async setProviderPlanId(planId, interval: Interval, id) { const p = m.plans.get(planId)!; m.plans.set(planId, { ...p, providerPlanIds: { ...p.providerPlanIds, [interval]: id } }); },
    async entitlements(t): Promise<Entitlements | null> {
      const s = m.subs.get(t); if (!s) return null;
      return { limits: { ...(m.plans.get(s.planId)?.limits ?? {}), ...(m.policyLimits.get(t) ?? {}) }, usage: m.usage.get(t) ?? {}, modules: m.plans.get(s.planId)?.modules ?? [] };
    },
    async countSeats(t) { return m.seats.get(t) ?? 0; },
    async listInvoices(t) { return [...m.invoices.values()].filter((i) => !t || i.tenantId === t).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    async getInvoice(id) { return m.invoices.get(id) ?? null; },
    async findInvoiceByPeriod(t, s, e) { return [...m.invoices.values()].find((i) => i.tenantId === t && i.periodStart === s && i.periodEnd === e && i.status !== "void") ?? null; },
    async createInvoice(i: NewInvoice) {
      seq += 1;
      const row: InvoiceRow = { id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, number: `INV/00-00/${String(seq).padStart(6, "0")}`, ...i, issuedAt: i.status === "draft" ? null : new Date().toISOString(), createdAt: new Date(2026, 0, 1, 0, 0, seq).toISOString() };
      m.invoices.set(row.id, row); return row;
    },
    async setInvoiceStatus(id, status: InvoiceStatus) { const i = m.invoices.get(id)!; m.invoices.set(id, { ...i, status }); },
  };
}
export type { SubscriptionRow };
