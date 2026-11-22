// Billing use-cases, dependency-injected (store, clock, env, fetch, audit) so they run in Vitest with no network or database.
// Authorisation is the caller's job (server actions, route handlers); every mutation here writes one audit line through deps.audit.
import { graceDays, issuerConfig, razorpayConfig, type IssuerConfig, GSTIN_RE } from "./config";
import { computeTax, placeOfSupply } from "./gst";
import { renderInvoicePdf } from "./pdf";
import { mapSubscriptionEvent, razorpayClient, RazorpayError, verifyWebhook, type RazorpayClient } from "./razorpay";
import { orgState, seatLimit, seatStatus, type OrgState, type SeatStatus } from "./state";
import type { BillingStore, SubscriptionPatch } from "./store";
import type { BillingAddress, Interval, InvoiceRow, InvoiceStatus, PlanRow, SubscriptionRow, SubStatus, TenantRow } from "./types";

export interface AuditLine { action: string; summary: string; detail?: Record<string, unknown>; object?: { table: string; id?: string } }
export interface Deps {
  store: BillingStore; env: Record<string, string | undefined>; now: () => Date; fetchImpl?: typeof fetch;
  audit: (l: AuditLine) => Promise<void>;
}
export type Fail<C extends string = string> = { ok: false; code: C; detail?: string };
export type Ok<T = undefined> = { ok: true; data: T };
export type Res<T = undefined, C extends string = string> = Ok<T> | Fail<C>;
const ok = <T,>(data: T): Ok<T> => ({ ok: true, data });
const fail = <C extends string>(code: C, detail?: string): Fail<C> => ({ ok: false, code, detail });

/** Razorpay needs a finite count of cycles. Ten years either way; cancel any time. */
export const TERM_CYCLES: Record<Interval, number> = { monthly: 120, yearly: 10 };

export interface Snapshot {
  tenant: TenantRow; sub: SubscriptionRow | null; plan: PlanRow | null; org: OrgState; seats: SeatStatus;
  limits: Record<string, number>; usage: Record<string, number>;
}
export async function snapshot(d: Deps, tenantId: string): Promise<Snapshot | null> {
  const [tenant, sub] = await Promise.all([d.store.getTenant(tenantId), d.store.getSubscription(tenantId)]);
  if (!tenant) return null;
  const [plan, ent, used] = await Promise.all([sub ? d.store.getPlan(sub.planId) : Promise.resolve(null), d.store.entitlements(tenantId), d.store.countSeats(tenantId)]);
  const limits = ent?.limits ?? plan?.limits ?? {};
  return {
    tenant, sub, plan, limits, usage: ent?.usage ?? {},
    org: orgState({ tenant, sub, now: d.now(), graceDays: graceDays(d.env) }),
    seats: seatStatus(used, seatLimit(limits, sub?.seats ?? null)),
  };
}
// ---------- tenant side ----------
export type StartErr = "no_subscription" | "plan_unavailable" | "price_not_set" | "issuer_unconfigured" | "razorpay_unconfigured" | "live_refused" | "razorpay_error" | "already_active";
/** Amount Razorpay charges per cycle = plan price (tax exclusive) + GST at the issuer rate. The invoice later splits it back. */
export const chargeAmount = (pricePaise: number, rate: number, issuer: string): number => pricePaise + computeTax(pricePaise, rate, issuer, null).total;

export async function startSubscription(d: Deps, a: { tenantId: string; planId: string; interval: Interval; actor: string }): Promise<Res<{ url: string | null; subscriptionId: string; mode: "test" | "live" }, StartErr>> {
  const sub = await d.store.getSubscription(a.tenantId);
  if (!sub) return fail("no_subscription");
  if (sub.status === "active" && sub.planId === a.planId) return fail("already_active");
  const plan = await d.store.getPlan(a.planId);
  if (!plan || !plan.isPublic) return fail("plan_unavailable");
  const price = a.interval === "yearly" ? plan.pricePaiseYearly : plan.pricePaiseMonthly;
  if (!(price > 0)) return fail("price_not_set");
  const iss = issuerConfig(d.env);
  if (!iss.ok) return fail("issuer_unconfigured", iss.missing.join(", "));
  const rz = razorpayConfig(d.env);
  if (!rz.ok) return fail(rz.reason === "live_refused" ? "live_refused" : "razorpay_unconfigured", rz.reason);
  const client = razorpayClient(rz.cfg, d.fetchImpl);
  try {
    let providerPlan = plan.providerPlanIds[a.interval];
    if (!providerPlan) {
      providerPlan = (await client.createPlan(plan, a.interval, chargeAmount(price, iss.cfg.gstRatePercent, iss.cfg.gstin))).id;
      await d.store.setProviderPlanId(plan.id, a.interval, providerPlan);
    }
    const rs = await client.createSubscription({ providerPlanId: providerPlan, appPlanId: plan.id, tenantId: a.tenantId, quantity: 1, totalCount: TERM_CYCLES[a.interval] });
    // Record the pending subscription id so the webhook can be matched; plan and status change only when Razorpay says it is active.
    await d.store.patchSubscription(a.tenantId, { provider: "razorpay", providerSubscriptionId: rs.id });
    await d.audit({ action: "billing.subscription_started", summary: `Subscription started for plan ${plan.id} (${a.interval}, ${rz.cfg.mode} mode)`, detail: { plan: plan.id, interval: a.interval, subscription: rs.id, mode: rz.cfg.mode }, object: { table: "tenant_subscriptions", id: a.tenantId } });
    return ok({ url: rs.short_url ?? null, subscriptionId: rs.id, mode: rz.cfg.mode });
  } catch (e) {
    if (e instanceof RazorpayError) return fail("razorpay_error", e.message);
    throw e;
  }
}

export async function cancelSubscription(d: Deps, a: { tenantId: string; atCycleEnd?: boolean }): Promise<Res<undefined, "no_provider_subscription" | "razorpay_unconfigured" | "razorpay_error">> {
  const sub = await d.store.getSubscription(a.tenantId);
  if (!sub?.providerSubscriptionId || sub.provider !== "razorpay") return fail("no_provider_subscription");
  const rz = razorpayConfig(d.env);
  if (!rz.ok) return fail("razorpay_unconfigured", rz.reason);
  try {
    await razorpayClient(rz.cfg, d.fetchImpl).cancelSubscription(sub.providerSubscriptionId, a.atCycleEnd !== false);
  } catch (e) {
    if (e instanceof RazorpayError) return fail("razorpay_error", e.message);
    throw e;
  }
  // The cancelled webhook flips the status; at cycle end the paid period stays usable. Nothing is changed locally here.
  await d.audit({ action: "billing.subscription_cancel_requested", summary: `Cancellation requested${a.atCycleEnd === false ? " (immediate)" : " (at cycle end)"}`, object: { table: "tenant_subscriptions", id: a.tenantId } });
  return ok(undefined);
}

export interface DetailsInput { gstin?: string | null; address?: BillingAddress | null }
export async function updateBillingDetails(d: Deps, a: { tenantId: string } & DetailsInput): Promise<Res<undefined, "bad_gstin" | "no_subscription">> {
  const gstin = a.gstin ? a.gstin.trim().toUpperCase() : null;
  if (gstin && !GSTIN_RE.test(gstin)) return fail("bad_gstin");
  if (!(await d.store.getSubscription(a.tenantId))) return fail("no_subscription");
  const patch: SubscriptionPatch = { gstin };
  if (a.address !== undefined) patch.billingAddress = a.address;
  await d.store.patchSubscription(a.tenantId, patch);
  await d.audit({ action: "billing.details_updated", summary: "Billing details updated", detail: { has_gstin: !!gstin }, object: { table: "tenant_subscriptions", id: a.tenantId } });
  return ok(undefined);
}

// ---------- webhook ----------
export type WebhookOutcome = "applied" | "ignored" | "unknown_subscription";
export async function handleWebhook(d: Deps, rawBody: string, signature: string | null): Promise<Res<WebhookOutcome, "bad_signature" | "bad_body">> {
  const rz = razorpayConfig(d.env);
  if (!rz.ok || !verifyWebhook(rz.cfg.webhookSecret, rawBody, signature)) return fail("bad_signature");
  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return fail("bad_body"); }
  const ev = mapSubscriptionEvent(body);
  if (ev.kind === "ignore" || !ev.tenantId) return ok("ignored");
  const sub = await d.store.getSubscription(ev.tenantId);
  // Only subscriptions this platform started for that tenant are honoured: a valid signature on a foreign id changes nothing.
  if (!sub || sub.providerSubscriptionId !== ev.subscriptionId) return ok("unknown_subscription");
  const patch: SubscriptionPatch = {};
  if (ev.currentEnd) patch.currentPeriodEnd = ev.currentEnd;
  if (ev.kind === "activated" || ev.kind === "charged") {
    patch.status = "active";
    if (ev.appPlanId && (await d.store.getPlan(ev.appPlanId))) patch.planId = ev.appPlanId;
  } else patch.status = ev.kind === "past_due" ? "past_due" : "cancelled";
  await d.store.patchSubscription(ev.tenantId, patch);
  if (ev.kind === "charged") await recordCharge(d, { ...sub, ...patch } as SubscriptionRow, ev.paymentId);
  await d.audit({ action: `billing.subscription_${ev.kind}`, summary: `Razorpay subscription ${ev.kind}`, detail: { subscription: ev.subscriptionId, payment: "paymentId" in ev ? ev.paymentId : null }, object: { table: "tenant_subscriptions", id: ev.tenantId } });
  return ok("applied");
}
const istDate = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** One paid invoice per charged cycle, keyed by tenant and period so a redelivered webhook is a no-op. */
async function recordCharge(d: Deps, sub: SubscriptionRow, paymentId: string | null): Promise<void> {
  const iss = issuerConfig(d.env);
  const plan = await d.store.getPlan(sub.planId);
  if (!iss.ok || !plan) { await d.audit({ action: "billing.invoice_skipped", summary: "Charge received but no invoice was created (issuer config or plan missing)", detail: { payment: paymentId } }); return; }
  const start = istDate(d.now()), end = sub.currentPeriodEnd ? istDate(new Date(sub.currentPeriodEnd)) : start;
  if (await d.store.findInvoiceByPeriod(sub.tenantId, start, end)) return;
  // The cycle length is not in the payload; the plan interval is inferred from the span to current_end.
  const span = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  const price = span > 200 ? plan.pricePaiseYearly : plan.pricePaiseMonthly;
  await createInvoiceFor(d, iss.cfg, { sub, periodStart: start, periodEnd: end, amountPaise: price, status: "paid" });
}

// ---------- invoices ----------
async function createInvoiceFor(d: Deps, iss: IssuerConfig, a: { sub: SubscriptionRow; periodStart: string; periodEnd: string; amountPaise: number; status: InvoiceStatus }): Promise<InvoiceRow> {
  const tax = computeTax(a.amountPaise, iss.gstRatePercent, iss.gstin, placeOfSupply(a.sub.gstin, a.sub.billingAddress?.stateCode));
  const inv = await d.store.createInvoice({ tenantId: a.sub.tenantId, periodStart: a.periodStart, periodEnd: a.periodEnd, amountPaise: a.amountPaise, gstPaise: tax.total, sacCode: iss.sac, status: a.status });
  await d.audit({ action: "billing.invoice_created", summary: `Invoice ${inv.number} created (${a.status})`, detail: { amount_paise: a.amountPaise, gst_paise: tax.total }, object: { table: "invoices", id: inv.id } });
  return inv;
}

export type InvErr = "issuer_unconfigured" | "no_subscription" | "bad_period" | "bad_amount" | "not_found" | "bad_transition" | "duplicate_period";
export async function createManualInvoice(d: Deps, a: { tenantId: string; periodStart: string; periodEnd: string; amountPaise: number; issue?: boolean }): Promise<Res<InvoiceRow, InvErr>> {
  const iss = issuerConfig(d.env);
  if (!iss.ok) return fail("issuer_unconfigured", iss.missing.join(", "));
  const sub = await d.store.getSubscription(a.tenantId);
  if (!sub) return fail("no_subscription");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(a.periodEnd) || a.periodEnd < a.periodStart) return fail("bad_period");
  if (!Number.isInteger(a.amountPaise) || a.amountPaise < 0) return fail("bad_amount");
  if (await d.store.findInvoiceByPeriod(a.tenantId, a.periodStart, a.periodEnd)) return fail("duplicate_period");
  return ok(await createInvoiceFor(d, iss.cfg, { sub, periodStart: a.periodStart, periodEnd: a.periodEnd, amountPaise: a.amountPaise, status: a.issue ? "issued" : "draft" }));
}

/** Allowed manual transitions. Issued invoices are immutable except for status (0020 trigger); void is final. */
export const INVOICE_NEXT: Record<InvoiceStatus, InvoiceStatus[]> = { draft: ["issued", "void"], issued: ["paid", "void"], paid: ["void"], void: [] };
export async function setInvoiceStatus(d: Deps, a: { id: string; to: InvoiceStatus }): Promise<Res<undefined, InvErr>> {
  const inv = await d.store.getInvoice(a.id);
  if (!inv) return fail("not_found");
  if (!INVOICE_NEXT[inv.status].includes(a.to)) return fail("bad_transition", `${inv.status} -> ${a.to}`);
  await d.store.setInvoiceStatus(a.id, a.to);
  await d.audit({ action: `billing.invoice_${a.to}`, summary: `Invoice ${inv.number} set to ${a.to}`, object: { table: "invoices", id: inv.id } });
  return ok(undefined);
}

export async function invoicePdf(d: Deps, id: string, scopeTenantId?: string): Promise<Res<{ filename: string; bytes: Uint8Array }, "not_found" | "issuer_unconfigured">> {
  const inv = await d.store.getInvoice(id);
  if (!inv || (scopeTenantId && inv.tenantId !== scopeTenantId)) return fail("not_found");
  if (scopeTenantId && inv.status === "draft") return fail("not_found");   // drafts are not visible to the customer
  const iss = issuerConfig(d.env);
  if (!iss.ok) return fail("issuer_unconfigured", iss.missing.join(", "));
  const [sub, tenant] = await Promise.all([d.store.getSubscription(inv.tenantId), d.store.getTenant(inv.tenantId)]);
  const bytes = renderInvoicePdf({
    invoice: inv, issuer: iss.cfg, description: "Platform subscription",
    buyer: { name: sub?.billingAddress?.name || tenant?.name || "Customer", gstin: sub?.gstin ?? null, address: sub?.billingAddress ?? null },
  });
  return ok({ filename: `${inv.number.replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`, bytes });
}

// ---------- platform admin ----------
export interface SubscriptionEdit { tenantId: string; planId?: string; status?: SubStatus; seats?: number | null; trialEndsAt?: string | null; currentPeriodEnd?: string | null }
export async function adminSetSubscription(d: Deps, a: SubscriptionEdit & { reason: string }): Promise<Res<undefined, "no_subscription" | "unknown_plan" | "bad_value" | "reason_required">> {
  if (a.reason.trim().length < 8) return fail("reason_required");
  if (!(await d.store.getSubscription(a.tenantId))) return fail("no_subscription");
  if (a.planId && !(await d.store.getPlan(a.planId))) return fail("unknown_plan");
  if (a.seats != null && (!Number.isInteger(a.seats) || a.seats < 0)) return fail("bad_value", "seats");
  for (const k of ["trialEndsAt", "currentPeriodEnd"] as const) if (a[k] && Number.isNaN(Date.parse(a[k]!))) return fail("bad_value", k);
  const { tenantId, reason, ...patch } = a;
  await d.store.patchSubscription(tenantId, patch);
  await d.audit({ action: "billing.subscription_set", summary: `Subscription changed by platform billing (${Object.keys(patch).join(", ")})`, detail: { ...patch, reason }, object: { table: "tenant_subscriptions", id: tenantId } });
  return ok(undefined);
}
export async function adminSavePlan(d: Deps, p: Omit<PlanRow, "providerPlanIds">): Promise<Res<undefined, "bad_value">> {
  if (!/^[a-z][a-z0-9_-]{1,30}$/.test(p.id) || !p.name.trim() || p.pricePaiseMonthly < 0 || p.pricePaiseYearly < 0 || !Number.isInteger(p.pricePaiseMonthly) || !Number.isInteger(p.pricePaiseYearly)) return fail("bad_value");
  await d.store.savePlan(p);
  await d.audit({ action: "billing.plan_saved", summary: `Plan ${p.id} saved`, detail: { price_monthly_paise: p.pricePaiseMonthly, price_yearly_paise: p.pricePaiseYearly, limits: p.limits, public: p.isPublic }, object: { table: "plans", id: p.id } });
  return ok(undefined);
}
export type { RazorpayClient };
