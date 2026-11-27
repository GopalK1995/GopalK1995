"use client";
import { fieldCls } from "@/components/ui/field-styles";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { fmtInr } from "@/lib/billing/gst";
import { fill } from "@/lib/billing/strings";
import { SUB_STATUSES } from "@/lib/billing/types";
import { editSubscription, invoiceStatus, newInvoice, savePlan } from "../actions";
import type { AdminView } from "../view";

type S = Record<string, string>;
const t = (s: S, k: string, v?: Record<string, string | number>) => (s[k] ? fill(s[k], v ?? {}) : k);
const input = fieldCls;
const limitsText = (l: Record<string, number>) => Object.entries(l).map(([k, v]) => `${k}=${v}`).join(", ");
const parseLimits = (x: string): Record<string, number> => Object.fromEntries(x.split(",").map((p) => p.trim()).filter(Boolean).map((p) => { const [k, v] = p.split("="); return [k.trim(), Number(v)]; }).filter(([, v]) => Number.isFinite(v)));
const rupees = (p: number) => (Number.isFinite(p) ? (p / 100).toFixed(2) : "0.00");

export function BillingConsole({ view: v, strings: s }: { view: AdminView; strings: S }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message: string; sub?: string }>, after?: () => void) => start(async () => {
    const r = await fn();
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) { toast(r.message, v.demo ? t(s, "demoNotice") : undefined, { variant: "success" }); after?.(); router.refresh(); }
  });
  const form = (e: React.FormEvent<HTMLFormElement>) => Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
  const ro = !v.canEdit;

  return (
    <div className="space-y-5">
      <div className="text-[12px] text-ink-3" data-testid="issuer-line">{v.issuer.ok ? t(s, "issuerOk", { gstin: v.issuer.gstin, sac: v.issuer.sac, rate: v.issuer.rate }) : t(s, "issuerMissing", { names: v.issuer.missing.join(", ") })}</div>
      {ro && <div className="rounded-sm bg-paper-2 px-3 py-2 text-[13px] text-ink-2">{t(s, "adminReadOnlyNote")}</div>}
      {msg && <div role={msg.ok ? "status" : "alert"} className={`rounded-sm px-3 py-2 text-[13px] ${msg.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{msg.text}</div>}

      <Card>
        <CardHeader title={t(s, "subsTitle")} />
        <CardBody>
          {!v.subs.length ? <p className="text-[13px] text-ink-3">{t(s, "subsEmpty")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]" data-testid="subscriptions">
                <thead><tr className="text-ink-3"><th className="py-1 pr-3 font-medium">{t(s, "colTenant")}</th><th className="pr-3 font-medium">{t(s, "colPlan")}</th><th className="pr-3 font-medium">{t(s, "colStatus")}</th><th className="pr-3 font-medium">{t(s, "colSeats")}</th><th className="pr-3 font-medium">{t(s, "colTrialEnds")}</th><th className="pr-3 font-medium">{t(s, "colPeriodEnd")}</th><th className="pr-3 font-medium">{t(s, "colProvider")}</th><th /></tr></thead>
                <tbody>
                  {v.subs.map((r) => (
                    <tr key={r.tenantId} className="border-t border-line align-top" data-testid={`sub-${r.tenantId}`}>
                      <td className="py-1.5 pr-3 font-medium text-ink">{r.tenantName}{r.org.mode !== "ok" && <Badge tone="danger" className="ml-2">{r.org.mode === "suspended" ? "Suspended" : "Read-only"}</Badge>}</td>
                      <td className="pr-3">{r.planName}</td><td className="pr-3">{t(s, `status_${r.sub.status}`)}</td>
                      <td className="pr-3 num">{r.seats.limit == null ? `${r.seats.used} / ${t(s, "unlimited")}` : `${r.seats.used} / ${r.seats.limit}`}</td>
                      <td className="pr-3">{r.sub.trialEndsAt?.slice(0, 10) ?? "-"}</td><td className="pr-3">{r.sub.currentPeriodEnd?.slice(0, 10) ?? "-"}</td><td className="pr-3">{r.sub.provider ?? t(s, "none")}</td>
                      <td className="text-right"><Button size="sm" variant="quiet" disabled={ro} aria-label={`${t(s, "editSubscription")}: ${r.tenantName}`} onClick={() => setEditing(editing === r.tenantId ? null : r.tenantId)}>{t(s, "editSubscription")}</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {editing && (() => {
            const r = v.subs.find((x) => x.tenantId === editing)!;
            return (
              <form className="mt-4 grid gap-3 rounded-sm border border-line p-3 sm:grid-cols-3" data-testid="edit-subscription" onSubmit={(e) => { e.preventDefault(); const f = form(e); run(() => editSubscription({ tenantId: editing, planId: f.planId, status: f.status, seats: f.seats, trialEndsAt: f.trialEndsAt, currentPeriodEnd: f.currentPeriodEnd, reason: f.reason }), () => setEditing(null)); }}>
                <label className="text-[12px] font-medium text-ink-2">{t(s, "editPlan")}<select name="planId" defaultValue={r.sub.planId} className={`${input} mt-1`}>{v.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label className="text-[12px] font-medium text-ink-2">{t(s, "editStatus")}<select name="status" defaultValue={r.sub.status} className={`${input} mt-1`}>{SUB_STATUSES.map((x) => <option key={x} value={x}>{t(s, `status_${x}`)}</option>)}</select></label>
                <label className="text-[12px] font-medium text-ink-2">{t(s, "editSeatsPurchased")}<input name="seats" inputMode="numeric" defaultValue={r.sub.seats ?? ""} className={`${input} mt-1`} /></label>
                <label className="text-[12px] font-medium text-ink-2">{t(s, "editTrialEnds")}<input name="trialEndsAt" type="date" defaultValue={r.sub.trialEndsAt?.slice(0, 10) ?? ""} className={`${input} mt-1`} /></label>
                <label className="text-[12px] font-medium text-ink-2">{t(s, "editPeriodEnd")}<input name="currentPeriodEnd" type="date" defaultValue={r.sub.currentPeriodEnd?.slice(0, 10) ?? ""} className={`${input} mt-1`} /></label>
                <label className="text-[12px] font-medium text-ink-2">{t(s, "editReason")}<input name="reason" required minLength={8} className={`${input} mt-1`} /></label>
                <div className="sm:col-span-3"><Button type="submit" variant="primary" disabled={pending}>{t(s, "saveSubscription")}</Button></div>
              </form>
            );
          })()}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(s, "plansAdminTitle")} sub={t(s, "plansAdminSub")} />
        <CardBody className="space-y-3">
          {[...v.plans.map((p) => ({ id: p.id, name: p.name, monthly: rupees(p.pricePaiseMonthly), yearly: rupees(p.pricePaiseYearly), limits: limitsText(p.limits), isPublic: p.isPublic })), { id: "", name: "", monthly: "0.00", yearly: "0.00", limits: "", isPublic: false }].map((p) => (
            <form key={p.id || "new"} aria-label={p.id ? t(s, "planFormLabel", { name: p.name || p.id }) : t(s, "planNewHeading")} className="grid gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[110px_1fr_110px_110px_1.4fr_auto_auto] sm:items-end" data-testid={p.id ? `plan-${p.id}` : "plan-new"}
              onSubmit={(e) => { e.preventDefault(); const f = form(e); run(() => savePlan({ id: f.id, name: f.name, monthly: f.monthly, yearly: f.yearly, limits: parseLimits(f.limits), isPublic: f.isPublic === "on" })); }}>
              <h3 className="text-[13px] font-semibold text-ink sm:col-span-full">{p.id ? p.name || p.id : t(s, "planNewHeading")}</h3>
              <label className="text-[12px] text-ink-3">{t(s, "colPlanId")}<input name="id" defaultValue={p.id} readOnly={!!p.id} disabled={ro} className={`${input} mt-1`} /></label>
              <label className="text-[12px] text-ink-3">{t(s, "colPlanName")}<input name="name" defaultValue={p.name} disabled={ro} className={`${input} mt-1`} /></label>
              <label className="text-[12px] text-ink-3">{t(s, "colMonthly")}<input name="monthly" defaultValue={p.monthly} inputMode="decimal" disabled={ro} className={`${input} mt-1`} /></label>
              <label className="text-[12px] text-ink-3">{t(s, "colYearly")}<input name="yearly" defaultValue={p.yearly} inputMode="decimal" disabled={ro} className={`${input} mt-1`} /></label>
              <label className="text-[12px] text-ink-3">{t(s, "colLimits")}<input name="limits" defaultValue={p.limits} disabled={ro} className={`${input} mt-1`} /></label>
              <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-2"><input type="checkbox" name="isPublic" defaultChecked={p.isPublic} disabled={ro} />{t(s, "colPublic")}</label>
              <Button type="submit" size="sm" variant={p.id ? "quiet" : "primary"} disabled={ro || pending} aria-label={p.id ? `${t(s, "savePlan")}: ${p.name || p.id}` : undefined}>{p.id ? t(s, "savePlan") : t(s, "newPlan")}</Button>
            </form>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(s, "invoicesAdminTitle")} sub={t(s, "invoicesAdminSub")} />
        <CardBody className="space-y-4">
          <form className="grid gap-3 rounded-sm border border-line p-3 sm:grid-cols-5 sm:items-end" data-testid="new-invoice" onSubmit={(e) => { e.preventDefault(); const f = form(e); run(() => newInvoice({ tenantId: f.tenantId, periodStart: f.periodStart, periodEnd: f.periodEnd, amount: f.amount, issue: f.issue === "on" }), () => e.currentTarget.reset()); }}>
            <label className="text-[12px] font-medium text-ink-2">{t(s, "colTenant")}<select name="tenantId" disabled={ro} className={`${input} mt-1`}>{v.subs.map((r) => <option key={r.tenantId} value={r.tenantId}>{r.tenantName}</option>)}</select></label>
            <label className="text-[12px] font-medium text-ink-2">{t(s, "fieldPeriodStart")}<input name="periodStart" type="date" required disabled={ro} className={`${input} mt-1`} /></label>
            <label className="text-[12px] font-medium text-ink-2">{t(s, "fieldPeriodEnd")}<input name="periodEnd" type="date" required disabled={ro} className={`${input} mt-1`} /></label>
            <label className="text-[12px] font-medium text-ink-2">{t(s, "fieldAmountInr")}<input name="amount" inputMode="decimal" required disabled={ro} className={`${input} mt-1`} /></label>
            <div className="space-y-1.5"><label className="flex items-center gap-1.5 text-[12px] text-ink-2"><input type="checkbox" name="issue" disabled={ro} />{t(s, "issueNow")}</label><Button type="submit" variant="primary" disabled={ro || pending}>{t(s, "createInvoice")}</Button></div>
          </form>
          {!v.invoices.length ? <p className="text-[13px] text-ink-3">{t(s, "invoicesEmpty")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]" data-testid="invoices">
                <thead><tr className="text-ink-3"><th className="py-1 pr-3 font-medium">{t(s, "colNumber")}</th><th className="pr-3 font-medium">{t(s, "colTenant")}</th><th className="pr-3 font-medium">{t(s, "colPeriod")}</th><th className="pr-3 text-right font-medium">{t(s, "colAmount")}</th><th className="pr-3 text-right font-medium">{t(s, "colGst")}</th><th className="pr-3 font-medium">{t(s, "colStatus")}</th><th /></tr></thead>
                <tbody>
                  {v.invoices.map((i) => (
                    <tr key={i.id} className="border-t border-line">
                      <td className="py-1.5 pr-3 font-medium text-ink">{i.number}</td><td className="pr-3">{i.tenantName}</td><td className="pr-3 text-ink-2">{i.periodStart} to {i.periodEnd}</td>
                      <td className="pr-3 text-right num">{fmtInr(i.amountPaise)}</td><td className="pr-3 text-right num">{fmtInr(i.gstPaise)}</td>
                      <td className="pr-3" data-testid={`inv-status-${i.number}`}>{t(s, `inv_${i.status}`)}</td>
                      <td className="space-x-1 text-right whitespace-nowrap">
                        {i.status === "draft" && <Button size="sm" variant="quiet" disabled={ro || pending} onClick={() => run(() => invoiceStatus({ id: i.id, to: "issued" }))}>{t(s, "markIssued")}</Button>}
                        {i.status === "issued" && <Button size="sm" variant="quiet" disabled={ro || pending} onClick={() => run(() => invoiceStatus({ id: i.id, to: "paid" }))}>{t(s, "markPaid")}</Button>}
                        {i.status !== "void" && <Button size="sm" variant="danger" disabled={ro || pending} onClick={() => { if (window.confirm(`${t(s, "markVoid")} ${i.number}?`)) run(() => invoiceStatus({ id: i.id, to: "void" })); }}>{t(s, "markVoid")}</Button>}
                        {!v.demo && <a className="px-1 text-accent underline underline-offset-4" href={`/admin/billing/invoice/${i.id}`}>{t(s, "downloadPdf")}</a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
