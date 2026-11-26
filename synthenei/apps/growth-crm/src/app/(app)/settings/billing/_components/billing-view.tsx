"use client";
import { fieldCls } from "@/components/ui/field-styles";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Meter } from "@/components/ui/misc";
import { toastResult } from "@/components/ui/toast";
import { fmtInr } from "@/lib/billing/gst";
import { fill } from "@/lib/billing/strings";
import { cancel, saveDetails, subscribe } from "../actions";
import type { OwnerView } from "../_lib/view";

const input = fieldCls;
type S = Record<string, string>;
const t = (s: S, k: string, v?: Record<string, string | number>) => (s[k] ? fill(s[k], v ?? {}) : k);

function Banner({ v, s }: { v: OwnerView; s: S }) {
  const o = v.org;
  const msg = o.reason === "suspended" ? t(s, "bannerSuspended")
    : o.reason === "trial_ended" ? t(s, "bannerTrialEnded") : o.reason === "cancelled" ? t(s, "bannerCancelled")
    : o.reason === "past_due" ? t(s, "bannerPastDueReadonly") : o.warn === "past_due" ? t(s, "bannerPastDue") : o.warn === "trial_ending" ? t(s, "bannerTrialEnding") : null;
  if (!msg) return null;
  const hard = o.mode !== "ok";
  return <div role={hard ? "alert" : "status"} className={`mb-4 rounded-sm px-3 py-2.5 text-[13px] ${hard ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn-ink"}`}>{msg}</div>;
}

export function BillingView({ view: v, strings: s }: { view: OwnerView; strings: S }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [continueUrl, setContinueUrl] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message: string; sub?: string }>, after?: () => void) => start(async () => {
    const r = await fn();
    if (r.ok) { toastResult(r, { demo: v.demo }); after?.(); router.refresh(); } else setFieldErr(r.message);
  });
  const startSub = (planId: string, interval: "monthly" | "yearly") => start(async () => {
    setFieldErr(null);
    const r = await subscribe({ planId, interval });
    if (r.ok) { toastResult(r, { demo: v.demo }); if (r.data?.url) setContinueUrl(r.data.url); router.refresh(); } else setFieldErr(r.message);
  });
  const sb = v.seats;
  const pct = sb.limit ? sb.used / sb.limit : 0;
  const daysLeft = v.org.daysLeft;

  return (
    <div className="space-y-5">
      <Banner v={v} s={s} />
      {fieldErr && <div role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-[13px] text-danger">{fieldErr}</div>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card data-testid="billing-plan">
          <CardHeader title={t(s, "planLabel")} action={<Badge tone={v.mode === "test" ? "warn" : v.mode === "live" ? "success" : "neutral"}>{t(s, `modeBadge_${v.mode}`)}</Badge>} />
          <CardBody className="space-y-2 text-[13px]">
            <div className="flex items-center gap-2"><span className="text-[16px] font-semibold text-ink">{v.sub.planName}</span><Badge tone={v.sub.status === "active" ? "success" : v.sub.status === "past_due" || v.sub.status === "cancelled" ? "danger" : "accent"}>{t(s, `status_${v.sub.status}`)}</Badge></div>
            {v.sub.status === "trial" && v.org.trialEndsAt && <p className="text-ink-2">{daysLeft === 0 ? t(s, "trialEndsToday") : t(s, "trialEnds", { date: v.org.trialEndsAt.slice(0, 10), days: daysLeft ?? 0 })}</p>}
            {v.sub.currentPeriodEnd && v.sub.status !== "trial" && <p className="text-ink-2">{t(s, "colPeriodEnd")}: {v.sub.currentPeriodEnd.slice(0, 10)}</p>}
            {v.canManage && v.sub.provider === "razorpay" && v.sub.status === "active" && (
              <Button variant="danger" size="sm" disabled={pending} onClick={() => { if (window.confirm(t(s, "cancelConfirm"))) run(cancel); }}>{t(s, "cancelSubscription")}</Button>
            )}
          </CardBody>
        </Card>

        <Card data-testid="billing-seats">
          <CardHeader title={t(s, "seatsLabel")} />
          <CardBody className="space-y-2 text-[13px]">
            <p className="text-ink">{sb.limit == null ? t(s, "seatsUnlimited", { used: sb.used }) : t(s, "seatsUsed", { used: sb.used, limit: sb.limit })}</p>
            {sb.limit != null && <Meter value={sb.used} max={sb.limit} tone={sb.over ? "danger" : pct >= 0.8 ? "warn" : "accent"} />}
            {sb.over ? <p className="text-danger">{t(s, "seatsOver")}</p> : sb.atLimit ? <p className="text-warn-ink">{t(s, "seatsFull")}</p> : null}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t(s, "plansTitle")} sub={t(s, "plansSub")} />
        <CardBody>
          {!v.plans.length ? <p className="text-[13px] text-ink-3">{t(s, "plansEmpty")}</p> : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {v.plans.map((p) => (
                <li key={p.id} data-testid={`plan-${p.id}`} className="rounded-sm border border-line p-3 text-[13px]">
                  <div className="flex items-center justify-between"><span className="font-semibold text-ink">{p.name}</span>{p.isCurrent && <Badge tone="accent">{t(s, "currentPlan")}</Badge>}</div>
                  <div className="mt-1 text-ink-2">{p.monthly > 0 ? `${fmtInr(p.monthly)} ${t(s, "perMonth")}` : t(s, "priceNotSet")}{p.yearly > 0 && ` · ${fmtInr(p.yearly)} ${t(s, "perYear")}`}</div>
                  {p.seatLimit != null && <div className="text-ink-3">{t(s, "seatsLabel")}: {p.seatLimit}</div>}
                  {v.canManage && !p.isCurrent && (p.monthly > 0 || p.yearly > 0) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {p.monthly > 0 && <Button size="sm" variant="primary" disabled={pending} onClick={() => startSub(p.id, "monthly")}>{t(s, "subscribeMonthly")}</Button>}
                      {p.yearly > 0 && <Button size="sm" disabled={pending} onClick={() => startSub(p.id, "yearly")}>{t(s, "subscribeYearly")}</Button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {continueUrl && <p className="mt-3"><a className="text-accent underline underline-offset-4" href={continueUrl} rel="noreferrer">{t(s, "subscribeContinue")}</a></p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(s, "detailsTitle")} sub={t(s, "detailsSub")} />
        <CardBody>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
            run(() => saveDetails(f));
          }}>
            {([["name", "fieldName", v.address?.name], ["gstin", "fieldGstin", v.sub.gstin], ["line1", "fieldLine1", v.address?.line1], ["line2", "fieldLine2", v.address?.line2], ["city", "fieldCity", v.address?.city], ["state", "fieldState", v.address?.state], ["stateCode", "fieldStateCode", v.address?.stateCode], ["pincode", "fieldPincode", v.address?.pincode], ["email", "fieldEmail", v.address?.email]] as const).map(([name, label, val]) => (
              <label key={name} className="block text-[12px] font-medium text-ink-2">{t(s, label)}
                <input name={name} defaultValue={val ?? ""} disabled={!v.canManage} className={`${input} mt-1`} autoComplete="off" />
              </label>
            ))}
            <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={!v.canManage || pending}>{t(s, "saveDetails")}</Button></div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t(s, "invoicesTitle")} />
        <CardBody>
          {!v.invoices.length ? <p className="text-[13px] text-ink-3">{t(s, "invoicesEmpty")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]" data-testid="invoices">
                <thead><tr className="text-ink-3"><th className="py-1 pr-3 font-medium">{t(s, "colNumber")}</th><th className="pr-3 font-medium">{t(s, "colPeriod")}</th><th className="pr-3 text-right font-medium">{t(s, "colAmount")}</th><th className="pr-3 text-right font-medium">{t(s, "colGst")}</th><th className="pr-3 font-medium">{t(s, "colStatus")}</th><th /></tr></thead>
                <tbody>
                  {v.invoices.map((i) => (
                    <tr key={i.id} className="border-t border-line">
                      <td className="py-1.5 pr-3 font-medium text-ink">{i.number}</td><td className="pr-3 text-ink-2">{i.periodStart} to {i.periodEnd}</td>
                      <td className="pr-3 text-right num">{fmtInr(i.amountPaise)}</td><td className="pr-3 text-right num">{fmtInr(i.gstPaise)}</td>
                      <td className="pr-3"><Badge tone={i.status === "paid" ? "success" : i.status === "void" ? "neutral" : "accent"}>{t(s, `inv_${i.status}`)}</Badge></td>
                      <td className="text-right">{!v.demo && <a className="text-accent underline underline-offset-4" href={`/settings/billing/invoice/${i.id}`}>{t(s, "downloadPdf")}</a>}</td>
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
