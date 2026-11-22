// Supabase adapter for the billing store. Service role only (it counts seats across workspaces and writes subscription state
// that RLS reserves for platform billing admins); every caller authorises first. Tables: migration 0020.
import "server-only";
import { serviceDb } from "@/lib/db/service";
import { from } from "@/lib/db/query";
import { throwIfError } from "@/lib/db/errors";
import type { Db } from "@/lib/db/client";
import type { BillingStore, Entitlements } from "./store";
import type { Interval, InvoiceRow, PlanRow, SubscriptionRow, TenantRow } from "./types";

type R = Record<string, unknown>;
const num = (x: unknown) => (typeof x === "number" ? x : Number(x ?? 0));
const str = (x: unknown) => (x == null ? null : String(x));
const numMap = (x: unknown): Record<string, number> => Object.fromEntries(Object.entries((x ?? {}) as R).filter(([, v]) => typeof v === "number")) as Record<string, number>;

const toPlan = (r: R): PlanRow => ({
  id: String(r.id), name: String(r.name), pricePaiseMonthly: num(r.price_paise_monthly), pricePaiseYearly: num(r.price_paise_yearly),
  limits: numMap(r.limits), modules: (r.modules as string[] | null) ?? [], isPublic: r.is_public === true,
  providerPlanIds: ((r.provider_plan_ids ?? {}) as Partial<Record<Interval, string>>),   // column added by the T053 needs block; absent = {}
});
const toSub = (r: R): SubscriptionRow => ({
  tenantId: String(r.tenant_id), planId: String(r.plan_id), status: r.status as SubscriptionRow["status"], seats: r.seats == null ? null : num(r.seats),
  trialEndsAt: str(r.trial_ends_at), currentPeriodEnd: str(r.current_period_end), provider: str(r.provider), providerSubscriptionId: str(r.provider_subscription_id),
  gstin: str(r.gstin), billingAddress: (r.billing_address as SubscriptionRow["billingAddress"]) ?? null,
});
const toTenant = (r: R): TenantRow => ({ id: String(r.id), slug: String(r.slug), name: String(r.name), status: String(r.status ?? "active"), trialEndsAt: str(r.trial_ends_at) });
const toInvoice = (r: R): InvoiceRow => ({
  id: String(r.id), number: String(r.number), tenantId: String(r.tenant_id), periodStart: String(r.period_start), periodEnd: String(r.period_end),
  amountPaise: num(r.amount_paise), gstPaise: num(r.gst_paise), sacCode: String(r.sac_code), status: r.status as InvoiceRow["status"],
  issuedAt: str(r.issued_at), createdAt: String(r.created_at),
});
const SUB_COLS: Record<string, string> = {
  planId: "plan_id", status: "status", seats: "seats", trialEndsAt: "trial_ends_at", currentPeriodEnd: "current_period_end", provider: "provider",
  providerSubscriptionId: "provider_subscription_id", gstin: "gstin", billingAddress: "billing_address",
};
const list = (d: unknown): R[] => (Array.isArray(d) ? (d as R[]) : []);

export function supabaseBillingStore(db: Db = serviceDb()): BillingStore {
  return {
    async getTenant(id) { const r = await from(db, "tenants").select("id,slug,name,status,trial_ends_at").eq("id", id).maybeSingle(); throwIfError(r.error); return r.data ? toTenant(r.data as R) : null; },
    async listTenants() { const r = await from(db, "tenants").select("id,slug,name,status,trial_ends_at").order("name").limit(1000); throwIfError(r.error); return list(r.data).map(toTenant); },
    async getSubscription(t) { const r = await from(db, "tenant_subscriptions").select("*").eq("tenant_id", t).maybeSingle(); throwIfError(r.error); return r.data ? toSub(r.data as R) : null; },
    async listSubscriptions() { const r = await from(db, "tenant_subscriptions").select("*").limit(1000); throwIfError(r.error); return list(r.data).map(toSub); },
    async patchSubscription(t, patch) {
      const row: R = {};
      for (const [k, v] of Object.entries(patch)) if (k in SUB_COLS && v !== undefined) row[SUB_COLS[k]] = v;
      const r = await from(db, "tenant_subscriptions").update(row).eq("tenant_id", t); throwIfError(r.error);
    },
    async listPlans() { const r = await from(db, "plans").select("*").order("created_at"); throwIfError(r.error); return list(r.data).map(toPlan); },
    async getPlan(id) { const r = await from(db, "plans").select("*").eq("id", id).maybeSingle(); throwIfError(r.error); return r.data ? toPlan(r.data as R) : null; },
    async savePlan(p) {
      const before = await from(db, "plans").select("price_paise_monthly,price_paise_yearly").eq("id", p.id).maybeSingle();
      const priceMoved = !!before.data && (num((before.data as R).price_paise_monthly) !== p.pricePaiseMonthly || num((before.data as R).price_paise_yearly) !== p.pricePaiseYearly);
      const row = { id: p.id, name: p.name, price_paise_monthly: p.pricePaiseMonthly, price_paise_yearly: p.pricePaiseYearly, limits: p.limits, modules: p.modules, is_public: p.isPublic };
      const r = await (from(db, "plans") as unknown as { upsert(v: R, o: R): Promise<{ error: null | { code?: string; message?: string } }> }).upsert(row, { onConflict: "id" });
      throwIfError(r.error);
      // A Razorpay plan is immutable: a new price needs a new one, created at the next checkout.
      if (priceMoved) await from(db, "plans").update({ provider_plan_ids: {} }).eq("id", p.id);
    },
    async setProviderPlanId(planId, interval, id) {
      const cur = await from(db, "plans").select("*").eq("id", planId).maybeSingle(); throwIfError(cur.error);
      const ids = { ...(((cur.data as R | null)?.provider_plan_ids ?? {}) as R), [interval]: id };
      const r = await from(db, "plans").update({ provider_plan_ids: ids }).eq("id", planId);
      if (r.error) console.error("[billing] could not cache the provider plan id (provider_plan_ids column missing? see T053 needs)");
    },
    async entitlements(t): Promise<Entitlements | null> {
      const r = await (db as unknown as { rpc(f: string, a: R): PromiseLike<{ data: unknown; error: null | { message?: string } }> }).rpc("tenant_entitlements", { p_tenant: t });
      if (r.error || !r.data) return null;
      const j = r.data as R;
      return { limits: numMap(j.limits), usage: numMap(j.usage), modules: (j.modules as string[]) ?? [] };
    },
    async countSeats(t) {
      const r = await from(db, "memberships").select("user_id,valid_until").eq("tenant_id", t).eq("is_active", true).limit(20000);
      throwIfError(r.error);
      const now = Date.now();
      return new Set(list(r.data).filter((m) => m.valid_until == null || Date.parse(String(m.valid_until)) > now).map((m) => String(m.user_id))).size;
    },
    async listInvoices(t) {
      let q = from(db, "invoices").select("*");
      if (t) q = q.eq("tenant_id", t);
      const r = await q.order("created_at", { ascending: false }).limit(500); throwIfError(r.error); return list(r.data).map(toInvoice);
    },
    async getInvoice(id) { const r = await from(db, "invoices").select("*").eq("id", id).maybeSingle(); throwIfError(r.error); return r.data ? toInvoice(r.data as R) : null; },
    async findInvoiceByPeriod(t, s, e) {
      const r = await from(db, "invoices").select("*").eq("tenant_id", t).eq("period_start", s).eq("period_end", e).neq("status", "void").limit(1); throwIfError(r.error);
      const row = list(r.data)[0]; return row ? toInvoice(row) : null;
    },
    async createInvoice(i) {
      // number and issued_at are set by the a50_invoices_guard trigger (gapless per financial year)
      const r = await from(db, "invoices").insert({ tenant_id: i.tenantId, period_start: i.periodStart, period_end: i.periodEnd, amount_paise: i.amountPaise, gst_paise: i.gstPaise, sac_code: i.sacCode, status: i.status }).select("*").single();
      throwIfError(r.error); return toInvoice(r.data as R);
    },
    async setInvoiceStatus(id, status) { const r = await from(db, "invoices").update({ status }).eq("id", id); throwIfError(r.error); },
  };
}
