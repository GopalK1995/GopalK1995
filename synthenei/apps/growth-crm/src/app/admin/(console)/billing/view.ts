// Server data for the platform billing console.
import "server-only";
import { issuerConfig } from "@/lib/billing/config";
import { billingDeps } from "@/lib/billing/runtime";
import { snapshot } from "@/lib/billing/service";
import type { OrgState, SeatStatus } from "@/lib/billing/state";
import type { InvoiceRow, PlanRow, SubscriptionRow } from "@/lib/billing/types";
import { ensureDemoTenant } from "@/lib/billing/demo";
import { TENANTS } from "@/lib/tenancy";

export interface SubRow { tenantId: string; tenantName: string; tenantStatus: string; sub: SubscriptionRow; planName: string; org: OrgState; seats: SeatStatus }
export interface AdminView {
  demo: boolean; canEdit: boolean; subs: SubRow[]; plans: PlanRow[]; invoices: (InvoiceRow & { tenantName: string })[];
  issuer: { ok: true; gstin: string; sac: string; rate: number } | { ok: false; missing: string[] };
}
export async function loadAdminBilling(a: { uid: string; demo: boolean; canEdit: boolean }): Promise<{ ok: true; view: AdminView } | { ok: false; error: string }> {
  try {
    const d = billingDeps({ kind: "platform", uid: a.uid, demo: a.demo }, a.demo);
    if (a.demo) for (const t of TENANTS) await ensureDemoTenant(d.store, t.id, t.name);
    const [tenants, plans, invoices] = await Promise.all([d.store.listTenants(), d.store.listPlans(), d.store.listInvoices(null)]);
    const snaps = await Promise.all(tenants.map((t) => snapshot(d, t.id)));
    const subs: SubRow[] = [];
    snaps.forEach((s, i) => { if (s?.sub) subs.push({ tenantId: tenants[i].id, tenantName: tenants[i].name, tenantStatus: tenants[i].status, sub: s.sub, planName: s.plan?.name ?? s.sub.planId, org: s.org, seats: s.seats }); });
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    const iss = issuerConfig(d.env);
    return {
      ok: true,
      view: {
        demo: a.demo, canEdit: a.canEdit, subs, plans,
        invoices: invoices.map((i) => ({ ...i, tenantName: names.get(i.tenantId) ?? i.tenantId })),
        issuer: iss.ok ? { ok: true, gstin: iss.cfg.gstin, sac: iss.cfg.sac, rate: iss.cfg.gstRatePercent } : iss,
      },
    };
  } catch (e) {
    console.error("[billing] admin view failed", (e as Error).message);
    return { ok: false, error: "Billing could not be loaded." };
  }
}
