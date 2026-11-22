"use server";
// Owner billing actions. Order: zod -> gate (session, no support, billing.manage) -> service (audited) -> revalidate.
// billing.manage is a write, so the authz engine denies it once the trial ended or the subscription lapsed (org_readonly). The owner must
// still be able to pay, so that one reason is let through here; a suspended organisation (org_suspended) stays blocked.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { failResult, okResult, runAction, type ActionResult } from "@/lib/actions/result";
import { requireActive } from "@/lib/auth/server";
import { AuthzError, decide } from "@/lib/authz/engine";
import { loadPrincipal } from "@/lib/authz/load";
import { billingDeps, invalidateBilling } from "@/lib/billing/runtime";
import { cancelSubscription, startSubscription, updateBillingDetails } from "@/lib/billing/service";
import { ensureDemoTenant } from "@/lib/billing/demo";
import { bt, errText } from "@/lib/billing/strings";

async function gate() {
  const { session, active } = await requireActive();
  if (active.support) throw new AuthzError({ allow: false, reason: "support_blocked", step: 4, permission: "billing.manage", maskedFields: [] });
  const p = await loadPrincipal();
  const d = decide(p, "billing.manage");
  if (!d.allow && d.reason !== "org_readonly") throw new AuthzError(d);
  if (!p.tenantId) throw new AuthzError({ allow: false, reason: "out_of_scope", step: 1, permission: "billing.manage", maskedFields: [] });
  const demo = session.demo === true;
  const deps = billingDeps({ kind: "principal", principal: p, demo }, demo);
  if (demo) await ensureDemoTenant(deps.store, p.tenantId, active.tenant.name ?? p.tenantId);
  return { demo, tenantId: p.tenantId, uid: session.uid, deps };
}
const done = (tenantId: string) => { invalidateBilling(tenantId); revalidatePath("/settings/billing"); };

const subscribeSchema = z.object({ planId: z.string().regex(/^[a-z][a-z0-9_-]{1,30}$/), interval: z.enum(["monthly", "yearly"]) });
export async function subscribe(raw: unknown): Promise<ActionResult<{ url: string | null; mode: "test" | "live" }>> {
  return runAction(async () => {
    const v = subscribeSchema.safeParse(raw);
    if (!v.success) return failResult("invalid", bt("err_bad_value"));
    const c = await gate();
    if (c.demo) return okResult(bt("subscribeStarted"), { sub: bt("demoNotice") });
    const r = await startSubscription(c.deps, { tenantId: c.tenantId, planId: v.data.planId, interval: v.data.interval, actor: c.uid });
    if (!r.ok) return failResult("invalid", errText(r.code), r.detail ? { sub: r.detail } : undefined);
    done(c.tenantId);
    return okResult(bt("subscribeStarted"), { data: { url: r.data.url, mode: r.data.mode } });
  });
}

export async function cancel(): Promise<ActionResult> {
  return runAction(async () => {
    const c = await gate();
    if (c.demo) return okResult(bt("cancelRequested"), { sub: bt("demoNotice") });
    const r = await cancelSubscription(c.deps, { tenantId: c.tenantId, atCycleEnd: true });
    if (!r.ok) return failResult("invalid", errText(r.code));
    done(c.tenantId);
    return okResult(bt("cancelRequested"));
  });
}

const s = (max: number) => z.string().trim().max(max).optional().transform((x) => x || undefined);
const detailsSchema = z.object({
  gstin: z.string().trim().toUpperCase().max(15).optional(), name: s(120), line1: s(120), line2: s(120), city: s(80), state: s(60),
  stateCode: z.string().trim().regex(/^[0-9]{2}$/).optional().or(z.literal("").transform(() => undefined)), pincode: s(10), email: z.string().trim().email().max(120).optional().or(z.literal("").transform(() => undefined)),
});
export async function saveDetails(raw: unknown): Promise<ActionResult> {
  return runAction(async () => {
    const v = detailsSchema.safeParse(raw);
    if (!v.success) return failResult("invalid", bt("err_bad_value"), { issues: v.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    const c = await gate();
    if (c.demo) return okResult(bt("detailsSaved"), { sub: bt("demoNotice") });
    const { gstin, ...addr } = v.data;
    const r = await updateBillingDetails(c.deps, { tenantId: c.tenantId, gstin: gstin || null, address: addr });
    if (!r.ok) return failResult("invalid", errText(r.code));
    done(c.tenantId);
    return okResult(bt("detailsSaved"));
  });
}
