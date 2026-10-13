"use client";
import { cloneElement, useState, useTransition, type ReactElement } from "react";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/dropdown";
import { useSession } from "@/components/shell/providers";
import { ROLE_LABEL } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";
import { logRestoreDrill, runHealthCheck, setAlertRule } from "./actions";

function Blocked({ reason, children }: { reason: string; children: ReactElement<{ disabled?: boolean }> }) {
  return <Tip content={reason}><span tabIndex={0} className="inline-flex rounded-sm">{cloneElement(children, { disabled: true })}</span></Tip>;
}
function useOperator() {
  const { role, support } = useSession();
  if (support?.mode === "read_only") return "Not available in a read-only support session.";
  if (!(role === "owner" || role === "data")) return `Owner or Data only. Your role: ${ROLE_LABEL[role]}.`;
  return null;
}

export function RunCheckButton() {
  const blocked = useOperator();
  const [pending, start] = useTransition();
  const btn = (
    <Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await runHealthCheck(); toast(r.message, r.detail); })}>
      <RefreshCw className={cn(pending && "motion-safe:animate-spin")} />{pending ? "Checking" : "Run check"}
    </Button>
  );
  return blocked ? <Blocked reason={blocked}>{btn}</Blocked> : btn;
}

export function LogDrillButton() {
  const blocked = useOperator();
  const btn = <Button><ClipboardCheck />Log restore drill</Button>;
  if (blocked) return <Blocked reason={blocked}>{btn}</Blocked>;
  const log = async (r: "pass" | "fail") => { const x = await logRestoreDrill(r); toast(x.message, x.detail); };
  return (
    <Menu>
      <MenuTrigger asChild>{btn}</MenuTrigger>
      <MenuContent>
        <MenuItem onSelect={() => log("pass")}>Passed: counts matched</MenuItem>
        <MenuItem onSelect={() => log("fail")}>Failed: needs follow-up</MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** Owner-only toggle (Data reads alert rules but does not edit them, spec 5). */
export function RuleToggle({ id, name, enabled }: { id: number; name: string; enabled: boolean }) {
  const { role, support } = useSession();
  const [on, set] = useState(enabled);
  const [pending, start] = useTransition();
  const reason = support?.mode === "read_only" ? "Not available in a read-only support session." : role !== "owner" ? `Only the Owner edits alert rules. Your role: ${ROLE_LABEL[role]}.` : null;
  const sw = (
    <button type="button" role="switch" aria-checked={on} aria-label={`${name}: ${on ? "on" : "off"}`} disabled={pending}
      onClick={() => { const n = !on; set(n); start(async () => { const r = await setAlertRule(id, n); if (!r.ok) set(!n); toast(r.message, r.detail); }); }}
      className={cn("relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:opacity-50",
        on ? "border-accent bg-accent" : "border-line-strong bg-paper-2")}>
      <span className={cn("absolute size-3.5 rounded-full bg-surface shadow-1 transition-transform duration-150", on ? "translate-x-[18px]" : "translate-x-[2px]")} />
    </button>
  );
  return reason ? <Blocked reason={reason}>{sw}</Blocked> : sw;
}
