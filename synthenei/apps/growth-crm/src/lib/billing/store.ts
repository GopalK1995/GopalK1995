// Storage port for platform billing. The Supabase adapter is store-supabase.ts; tests use an in-memory fake.
import type { Interval, InvoiceRow, InvoiceStatus, NewInvoice, PlanRow, SubscriptionRow, TenantRow } from "./types";

export interface Entitlements { limits: Record<string, number>; usage: Record<string, number>; modules: string[] }
export type SubscriptionPatch = Partial<Omit<SubscriptionRow, "tenantId">>;

export interface BillingStore {
  getTenant(id: string): Promise<TenantRow | null>;
  listTenants(): Promise<TenantRow[]>;
  getSubscription(tenantId: string): Promise<SubscriptionRow | null>;
  listSubscriptions(): Promise<SubscriptionRow[]>;
  patchSubscription(tenantId: string, patch: SubscriptionPatch): Promise<void>;
  listPlans(): Promise<PlanRow[]>;
  getPlan(id: string): Promise<PlanRow | null>;
  savePlan(p: Omit<PlanRow, "providerPlanIds">): Promise<void>;
  setProviderPlanId(planId: string, interval: Interval, providerPlanId: string): Promise<void>;
  /** tenant_entitlements(): plan limits overlaid with the org admin policy, plus this month's usage. */
  entitlements(tenantId: string): Promise<Entitlements | null>;
  /** Distinct active members across the tenant's workspaces (memberships). Platform admins in support sessions hold no membership and are not counted. */
  countSeats(tenantId: string): Promise<number>;
  listInvoices(tenantId: string | null): Promise<InvoiceRow[]>;
  getInvoice(id: string): Promise<InvoiceRow | null>;
  findInvoiceByPeriod(tenantId: string, periodStart: string, periodEnd: string): Promise<InvoiceRow | null>;
  createInvoice(i: NewInvoice): Promise<InvoiceRow>;
  setInvoiceStatus(id: string, status: InvoiceStatus): Promise<void>;
}
