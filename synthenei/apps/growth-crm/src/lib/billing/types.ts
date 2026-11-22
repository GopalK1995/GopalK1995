// Synthan's OWN billing (platform plans, subscriptions, GST invoices). Not the tenant payments connector (connectors/razorpay).
// Pure types: no server imports.
export type SubStatus = "trial" | "active" | "past_due" | "cancelled" | "manual";
export const SUB_STATUSES: SubStatus[] = ["trial", "active", "past_due", "cancelled", "manual"];
export type InvoiceStatus = "draft" | "issued" | "paid" | "void";
export type Interval = "monthly" | "yearly";

export interface PlanRow {
  id: string; name: string; pricePaiseMonthly: number; pricePaiseYearly: number;
  /** seats, workspaces, ai_calls, api_rpm, webhooks, custom_objects; absent = unlimited */
  limits: Record<string, number>; modules: string[]; isPublic: boolean;
  /** Razorpay plan ids by interval, cached after first creation (plans.provider_plan_ids, see T053 needs). */
  providerPlanIds: Partial<Record<Interval, string>>;
}
export interface BillingAddress { name?: string; line1?: string; line2?: string; city?: string; state?: string; stateCode?: string; pincode?: string; email?: string }
export interface SubscriptionRow {
  tenantId: string; planId: string; status: SubStatus; seats: number | null; trialEndsAt: string | null; currentPeriodEnd: string | null;
  provider: string | null; providerSubscriptionId: string | null; gstin: string | null; billingAddress: BillingAddress | null;
}
export interface TenantRow { id: string; slug: string; name: string; status: string; trialEndsAt: string | null }
export interface InvoiceRow {
  id: string; number: string; tenantId: string; periodStart: string; periodEnd: string; amountPaise: number; gstPaise: number;
  sacCode: string; status: InvoiceStatus; issuedAt: string | null; createdAt: string;
}
export interface NewInvoice { tenantId: string; periodStart: string; periodEnd: string; amountPaise: number; gstPaise: number; sacCode: string; status: InvoiceStatus }
