// One source of truth for plan, status and seats in the platform console (AUD-039). The billing subscription decides; the
// workspace-membership count and the org-admin policy cap are only fallbacks when a tenant has no subscription row.
// Pure helpers: the loader that reads the billing store lives in view.ts.
import type { Tenant } from "@/lib/tenancy";
import { TENANTS } from "@/lib/tenancy";
import type { DemoSeed } from "@/lib/billing/demo";
import { tenantSummary, type TenantSummary } from "../_components/data";

/** Seed for the in-memory demo subscription: the demo tenancy's plan, seat cap and distinct-member count. */
export function demoSeed(t: Tenant): DemoSeed {
  const s = tenantSummary(TENANTS.find((x) => x.id === t.id) ?? t);
  return { planName: t.plan, seats: t.seats, used: s.seatsUsed };
}

export interface SeatView { used: number; limit: number | null; plan: string; status: string; ratio: number | null; label: string; free: number | null }
const n = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** What every page shows for a tenant's seats and plan. Never NaN: an absent cap is "no cap", not a zero divisor. */
export function seatView(s: Pick<TenantSummary, "tenant" | "seatsUsed" | "billing">): SeatView {
  const b = s.billing;
  const used = n(b ? b.seatsUsed : s.seatsUsed);
  const limit = b ? b.seatLimit : (s.tenant.seats > 0 ? s.tenant.seats : null);
  const plan = b ? b.planName : s.tenant.plan;
  const status = b ? b.statusLabel : (s.tenant.status === "active" ? "Active" : "Suspended");
  const ratio = limit && limit > 0 ? used / limit : null;
  return { used, limit, plan, status, ratio, free: limit == null ? null : Math.max(0, limit - used),
    label: limit == null ? `${used} seat${used === 1 ? "" : "s"}, no cap` : `${used} of ${limit} seats` };
}

/** Subscription status words, shared with the Billing table (same wording as messages/en/billing.json status_*). */
export const SUB_LABEL: Record<string, string> = { trial: "Trial", active: "Active", past_due: "Payment overdue", cancelled: "Cancelled", manual: "Invoiced manually" };
