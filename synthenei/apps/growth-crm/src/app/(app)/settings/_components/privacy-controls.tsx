"use client";
// Privacy controls shared by the legacy Settings > Consent & privacy tab and the /settings/privacy pages.
// Erasure is owner-only and never in a support session; the confirm dialog names the person. The action returns a step report that is
// shown as a list (what was done, kept, failed, or left for a human), never just a success toast.
import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, CircleDashed, Eraser, HandHelping, Lock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Tip } from "@/components/ui/tooltip";
import { toastResult } from "@/components/ui/toast";
import { useSession } from "@/components/shell/providers";
import { ROLE_LABEL, can } from "@/lib/auth/roles";
import type { ErasureReport } from "@/lib/privacy/erasure";
import { prAll } from "@/lib/privacy/strings";
import { completeErasure } from "../privacy/actions";

type S = Record<string, string>;
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => String(k in v ? v[k] : m));
const STEP_TONE: Record<string, { tone: ChipTone; icon: typeof CheckCircle2 }> = {
  done: { tone: "success", icon: CheckCircle2 }, none: { tone: "neutral", icon: CircleDashed }, kept: { tone: "info", icon: Lock },
  manual: { tone: "warn", icon: HandHelping }, failed: { tone: "danger", icon: XCircle },
};

/** What an erasure did, step by step. */
export function ErasureReportList({ report, s = prAll("en") }: { report: ErasureReport; s?: S }) {
  return (
    <section aria-label={s["detail.erasure.reportTitle"]} data-testid="erasure-report" className="grid gap-1.5">
      <h3 className="text-13 font-medium text-ink">{s["detail.erasure.reportTitle"]}</h3>
      <ul className="grid gap-1">
        {report.steps.map((st) => {
          const m = STEP_TONE[st.status] ?? STEP_TONE.none, Icon = m.icon;
          return (
            <li key={st.id} className="flex flex-wrap items-center gap-2 text-13 text-ink" data-step={st.id} data-status={st.status}>
              <Chip tone={m.tone} icon={<Icon aria-hidden />}>{s[`stepstatus.${st.status}`]}</Chip>
              <span>{s[`step.${st.id}`] ?? st.id}{st.count != null ? ` (${st.count})` : ""}</span>
              {st.detail && <span className="text-12 text-ink-3">{st.detail}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Owner-only, never in a support session. Confirm dialog names the person (spec 5). */
export function EraseButton({ requestId, subject, disabledReason, onReport, s = prAll("en") }: { requestId: string; subject: string; disabledReason?: string; onReport?: (r: ErasureReport) => void; s?: S }) {
  const { role, support } = useSession();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const allowed = can("erase", { role, support }) && can("privacyRequests", { role, support }) && !disabledReason;
  const label = s["detail.erasure.run"];
  if (!allowed) {
    const why = disabledReason ?? (support ? s["result.supportBlocked"] : `${s["detail.erasure.owner"]} ${ROLE_LABEL[role]}.`);
    return <Tip content={why}><span tabIndex={0} className="inline-flex"><Button size="sm" variant="danger" disabled><Eraser />{label}</Button></span></Tip>;
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="danger" data-testid="erase-open"><Eraser />{label}</Button></DialogTrigger>
      <DialogContent title={fill(s["detail.erasure.confirmTitle"], { subject })} description={s["detail.erasure.confirmBody"]}>
        <div className="flex justify-end gap-2">
          <DialogClose asChild><Button>{s["detail.erasure.cancel"]}</Button></DialogClose>
          <Button variant="danger" disabled={pending} data-testid="erase-confirm" onClick={() => start(async () => {
            const r = await completeErasure(requestId);
            setOpen(false);
            toastResult(r);
            if (r.ok && r.data) onReport?.(r.data);
          })}>{label}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** One line on the legacy privacy tab that points at the full request inbox, retention and breach register. */
export function PrivacyHubLink({ s = prAll("en") }: { s?: S }) {
  return (
    <p className="text-13 text-ink-2" data-testid="privacy-hub-link">
      <Link href="/settings/privacy" className="font-medium text-accent underline">{s["owner.title"]}</Link>
      {" · "}<Link href="/settings/privacy/retention" className="font-medium text-accent underline">{s["owner.nav.retention"]}</Link>
      {" · "}<Link href="/settings/privacy/breaches" className="font-medium text-accent underline">{s["owner.nav.breaches"]}</Link>
    </p>
  );
}
