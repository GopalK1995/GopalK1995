"use client";
// Permission is decided on the server (the page passes `blocked`, a reason or null; every action re-checks with assertCan).
import { cloneElement, useState, useTransition, type ReactElement } from "react";
import { ClipboardCheck, HeartPulse, ListPlus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { toastResult } from "@/components/ui/toast";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Select } from "@/components/ui/controls";
import { cn } from "@/lib/utils";
import { createDefaultRules, logRestoreDrill, recordHeartbeatNow, runHealthCheck, setAlertRule } from "./actions";

function Blocked({ reason, children }: { reason: string; children: ReactElement<{ disabled?: boolean }> }) {
  return <Tip content={reason}><span tabIndex={0} className="inline-flex rounded-sm">{cloneElement(children, { disabled: true })}</span></Tip>;
}
const show = (r: { ok: boolean; message: string; sub?: string }) => toastResult(r);

export function RunCheckButton({ blocked }: { blocked: string | null }) {
  const [pending, start] = useTransition();
  const btn = (
    <Button variant="primary" disabled={pending} onClick={() => start(async () => show(await runHealthCheck()))}>
      <RefreshCw className={cn(pending && "motion-safe:animate-spin")} />{pending ? "Checking" : "Run check"}
    </Button>
  );
  return blocked ? <Blocked reason={blocked}>{btn}</Blocked> : btn;
}

export function HeartbeatButton({ blocked }: { blocked: string | null }) {
  const [pending, start] = useTransition();
  const btn = <Button disabled={pending} onClick={() => start(async () => show(await recordHeartbeatNow()))}><HeartPulse />{pending ? "Recording" : "Record heartbeat"}</Button>;
  return blocked ? <Blocked reason={blocked}>{btn}</Blocked> : btn;
}

export function DefaultRulesButton({ blocked }: { blocked: string | null }) {
  const [pending, start] = useTransition();
  const btn = <Button variant="primary" disabled={pending} onClick={() => start(async () => show(await createDefaultRules()))}><ListPlus />Create default rules</Button>;
  return blocked ? <Blocked reason={blocked}>{btn}</Blocked> : btn;
}

export function LogDrillButton({ blocked }: { blocked: string | null }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<"pass" | "fail">("pass");
  const [minutes, setMinutes] = useState("20");
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const btn = <Button><ClipboardCheck />Log restore drill</Button>;
  if (blocked) return <Blocked reason={blocked}>{btn}</Blocked>;
  const mins = Number(minutes);
  const valid = Number.isInteger(mins) && mins >= 0 && mins <= 1440;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{btn}</DialogTrigger>
      <DialogContent title="Log restore drill" description="Restore the latest full dump into a scratch database, compare row counts, then record the outcome here.">
        <form className="flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          start(async () => { const r = await logRestoreDrill({ result, durationMin: mins, notes }); show(r); if (r.ok) { setOpen(false); setNotes(""); } });
        }}>
          <Field label="Outcome">
            {(p) => <Select {...p} value={result} onValueChange={(v) => setResult(v as "pass" | "fail")} options={[{ value: "pass", label: "Passed: counts matched" }, { value: "fail", label: "Failed: needs follow-up" }]} />}
          </Field>
          <Field label="Minutes it took" error={valid ? undefined : "Whole minutes, 0 to 1440"}>
            {(p) => <Input {...p} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />}
          </Field>
          <Field label="Notes" help="What was restored, anything that differed. No personal data.">
            {(p) => <Textarea {...p} rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild><Button type="button">Cancel</Button></DialogClose>
            <Button type="submit" variant="primary" disabled={pending || !valid}>{pending ? "Saving" : "Save to drill log"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Owner-only toggle (backups.manage; Data reads alert rules but does not edit them). Persists through setAlertRule. */
export function RuleToggle({ id, name, enabled, blocked }: { id: string; name: string; enabled: boolean; blocked: string | null }) {
  const [on, set] = useState(enabled);
  const [pending, start] = useTransition();
  const sw = (
    <button type="button" role="switch" aria-checked={on} aria-label={`${name}: ${on ? "on" : "off"}`} disabled={pending}
      onClick={() => { const n = !on; set(n); start(async () => { const r = await setAlertRule(id, n); if (!r.ok) set(!n); show(r); }); }}
      className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-50",
        on ? "border-accent bg-accent" : "border-field-line bg-paper-2")}>
      <span className={cn("absolute size-3.5 rounded-full bg-surface shadow-1 transition-transform duration-150", on ? "translate-x-[18px]" : "translate-x-[2px]")} />
    </button>
  );
  return blocked ? <Blocked reason={blocked}>{sw}</Blocked> : sw;
}
