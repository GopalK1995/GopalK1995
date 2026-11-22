"use server";
// Platform billing actions. Order: platform session -> assertPlatform("platform.billing") through the authz engine -> zod -> service (audited).
// Platform roles: billing and super_admin hold platform.billing. Demo sessions use the in-memory store and a no-op audit.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { billingDeps, invalidateBilling } from "@/lib/billing/runtime";
import { adminSavePlan, adminSetSubscription, createManualInvoice, setInvoiceStatus } from "@/lib/billing/service";
import { ensureDemoTenant } from "@/lib/billing/demo";
import { rupeesToPaise } from "@/lib/billing/gst";
import { bt, errText } from "@/lib/billing/strings";
import { SUB_STATUSES } from "@/lib/billing/types";
import { TENANTS } from "@/lib/tenancy";
import { assertPlatform } from "../../_lib/platform-session";

async function gate() {
  const { session } = await assertPlatform("platform.billing");
  const demo = session.demo === true;
  const deps = billingDeps({ kind: "platform", uid: session.uid, demo }, demo);
  if (demo) for (const t of TENANTS) await ensureDemoTenant(deps.store, t.id, t.name);
  return { deps };
}
const done = (tenantId?: string) => { if (tenantId) invalidateBilling(tenantId); revalidatePath("/admin/billing"); };

const uuidOrSlug = z.string().min(1).max(64);
const dateOrNull = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().or(z.literal("").transform(() => null)).optional();

const subSchema = z.object({
  tenantId: uuidOrSlug, planId: z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/).optional(), status: z.enum(SUB_STATUSES as [string, ...string[]]).optional(),
  seats: z.union([z.coerce.number().int().min(0).max(1_000_000), z.literal("").transform(() => null)]).nullable().optional(),
  trialEndsAt: dateOrNull, currentPeriodEnd: dateOrNull, reason: z.string().trim().min(8).max(500),
});
export async function editSubscription(raw: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = subSchema.safeParse(raw);
    if (!v.success) return failResult("invalid", bt("err_reason_required"), { issues: v.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    const { deps } = await gate();
    const { trialEndsAt, currentPeriodEnd, ...rest } = v.data;
    const r = await adminSetSubscription(deps, { ...rest, status: rest.status as never, ...(trialEndsAt !== undefined && { trialEndsAt: trialEndsAt ? `${trialEndsAt}T23:59:59+05:30` : null }), ...(currentPeriodEnd !== undefined && { currentPeriodEnd: currentPeriodEnd ? `${currentPeriodEnd}T23:59:59+05:30` : null }) });
    if (!r.ok) return failResult("invalid", errText(r.code));
    done(v.data.tenantId);
    return okResult(bt("subscriptionSaved"));
  });
}

const planSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/), name: z.string().trim().min(1).max(60), monthly: z.string(), yearly: z.string(),
  limits: z.record(z.string().regex(/^[a-z][a-z0-9_]{1,30}$/), z.number().int().min(0).max(1_000_000_000)), isPublic: z.boolean(),
});
export async function savePlan(raw: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = planSchema.safeParse(raw);
    const monthly = v.success ? rupeesToPaise(v.data.monthly || "0") : null, yearly = v.success ? rupeesToPaise(v.data.yearly || "0") : null;
    if (!v.success || monthly == null || yearly == null) return failResult("invalid", bt("err_bad_value"));
    const { deps } = await gate();
    const r = await adminSavePlan(deps, { id: v.data.id, name: v.data.name, pricePaiseMonthly: monthly, pricePaiseYearly: yearly, limits: v.data.limits, modules: [], isPublic: v.data.isPublic });
    if (!r.ok) return failResult("invalid", errText(r.code));
    done();
    return okResult(bt("planSaved"));
  });
}

const invSchema = z.object({ tenantId: uuidOrSlug, periodStart: z.string(), periodEnd: z.string(), amount: z.string(), issue: z.boolean().optional() });
export async function newInvoice(raw: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = invSchema.safeParse(raw);
    if (!v.success) return failResult("invalid", bt("err_bad_value"));
    const paise = rupeesToPaise(v.data.amount);
    if (paise == null) return failResult("invalid", bt("err_bad_amount"));
    const { deps } = await gate();
    const r = await createManualInvoice(deps, { tenantId: v.data.tenantId, periodStart: v.data.periodStart, periodEnd: v.data.periodEnd, amountPaise: paise, issue: v.data.issue });
    if (!r.ok) return failResult("invalid", errText(r.code), r.detail ? { sub: r.detail } : undefined);
    done();
    return okResult(bt("invoiceCreated", { number: r.data.number }));
  });
}

const stSchema = z.object({ id: z.string().min(1).max(64), to: z.enum(["issued", "paid", "void"]) });
export async function invoiceStatus(raw: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = stSchema.safeParse(raw);
    if (!v.success) return failResult("invalid", bt("err_bad_value"));
    const { deps } = await gate();
    const r = await setInvoiceStatus(deps, v.data);
    if (!r.ok) return failResult("invalid", errText(r.code));
    done();
    return okResult(bt("invoiceStatusSet", { status: bt(`inv_${v.data.to}`) }));
  });
}
