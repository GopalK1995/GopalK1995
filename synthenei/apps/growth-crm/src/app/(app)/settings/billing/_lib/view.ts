// Server data for the owner billing page. Serialisable view only; nothing here mutates.
import "server-only";
import { requireActive } from "@/lib/auth/server";
import { decide } from "@/lib/authz/engine";
import { loadPrincipal } from "@/lib/authz/load";
import { razorpayConfig } from "@/lib/billing/config";
import { billingDeps } from "@/lib/billing/runtime";
import { supabaseBillingStore } from "@/lib/billing/store-supabase";
import { dbForRequest } from "@/lib/db/client";
import { classifyError, type ErrorCause } from "@/lib/billing/cause";
import type { Deps } from "@/lib/billing/service";
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
  | { status: "error"; cause: ErrorCause; supportEmail: string };

/** Read-only page: reads go through the signed-in user's own client (RLS lets the Owner read their tenant, plans and invoices), so the page
 * does not depend on the service-role key. Demo sessions use the in-memory store. */
async function readDeps(p: Awaited<ReturnType<typeof loadPrincipal>>, demo: boolean): Promise<Deps> {
  if (demo) return billingDeps({ kind: "principal", principal: p, demo }, demo);
  return { store: supabaseBillingStore(await dbForRequest()), env: process.env, now: () => new Date(), audit: async () => {} };
}

export async function loadOwnerBilling(): Promise<OwnerLoad> {
  let supportEmail = "";
  try {
    const { session, active } = await requireActive();
    supportEmail = active.tenant.supportEmail;
    if (active.support) return { status: "denied", reason: "support" };
    const p = await loadPrincipal();
    if (!decide(p, "billing.read").allow) return { status: "denied", reason: "role" };
    const demo = session.demo === true;
    const tenantId = p.tenantId;
    if (!tenantId) return { status: "error", cause: "unknown", supportEmail: active.tenant.supportEmail };
    const d = await readDeps(p, demo);
    if (demo) await ensureDemoTenant(d.store, tenantId, active.tenant.name ?? tenantId);
    const s = await snapshot(d, tenantId);
    if (!s?.sub) return { status: "error", cause: "unconfigured", supportEmail: active.tenant.supportEmail };
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
    const cause = classifyError(e);
    console.error(`[billing] owner view failed (cause: ${cause})`, (e as Error).message);
    return { status: "error", cause, supportEmail };
  }
}
