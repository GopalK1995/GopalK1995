// Server data for the owner billing page. Serialisable view only; nothing here mutates.
import "server-only";
import { requireActive } from "@/lib/auth/server";
import { decide } from "@/lib/authz/engine";
import { loadPrincipal } from "@/lib/authz/load";
import { razorpayConfig } from "@/lib/billing/config";
import { billingDeps } from "@/lib/billing/runtime";
import { snapshot } from "@/lib/billing/service";
import type { OrgState, SeatStatus } from "@/lib/billing/state";
import type { BillingAddress, InvoiceRow, SubscriptionRow } from "@/lib/billing/types";
import { ensureDemoTenant } from "@/lib/billing/demo";

export interface PlanCard { id: string; name: string; monthly: number; yearly: number; seatLimit: number | null; isCurrent: boolean }
export interface OwnerView {
  demo: boolean; canManage: boolean; tenantId: string; mode: "test" | "live" | "none";
  sub: Pick<SubscriptionRow, "planId" | "status" | "currentPeriodEnd" | "provider" | "providerSubscriptionId" | "gstin"> & { planName: string };
  address: BillingAddress | null; org: OrgState; seats: SeatStatus; plans: PlanCard[]; invoices: InvoiceRow[];
}
export type OwnerLoad =
  | { status: "ok"; view: OwnerView }
  | { status: "denied"; reason: "support" | "role" }
  | { status: "error" };

export async function loadOwnerBilling(): Promise<OwnerLoad> {
  try {
    const { session, active } = await requireActive();
    if (active.support) return { status: "denied", reason: "support" };
    const p = await loadPrincipal();
    if (!decide(p, "billing.read").allow) return { status: "denied", reason: "role" };
    const demo = session.demo === true;
    const tenantId = p.tenantId;
    if (!tenantId) return { status: "error" };
    const d = billingDeps({ kind: "principal", principal: p, demo }, demo);
    if (demo) await ensureDemoTenant(d.store, tenantId, active.tenant.name ?? tenantId);
    const s = await snapshot(d, tenantId);
    if (!s?.sub) return { status: "error" };
    const [plans, invoices] = await Promise.all([d.store.listPlans(), d.store.listInvoices(tenantId)]);
    const mg = decide(p, "billing.manage");
    const rz = razorpayConfig(d.env);
    return {
      status: "ok",
      view: {
        demo, tenantId, mode: rz.ok ? rz.cfg.mode : "none",
        // Read-only (trial ended, cancelled) must not stop the owner from paying: the billing actions allow org_readonly for billing.manage.
        canManage: mg.allow || mg.reason === "org_readonly",
        sub: { planId: s.sub.planId, planName: s.plan?.name ?? s.sub.planId, status: s.sub.status, currentPeriodEnd: s.sub.currentPeriodEnd, provider: s.sub.provider, providerSubscriptionId: s.sub.providerSubscriptionId, gstin: s.sub.gstin },
        address: s.sub.billingAddress, org: s.org, seats: s.seats,
        plans: plans.filter((x) => x.isPublic || x.id === s.sub!.planId).map((x) => ({ id: x.id, name: x.name, monthly: x.pricePaiseMonthly, yearly: x.pricePaiseYearly, seatLimit: x.limits.seats ?? null, isCurrent: x.id === s.sub!.planId })),
        invoices: invoices.filter((i) => i.status !== "draft"),
      },
    };
  } catch (e) {
    console.error("[billing] owner view failed", (e as Error).message);
    return { status: "error" };
  }
}
