"use client";
// Start a support session: tenant -> workspace, mode, typed reason (20+ chars, counter announced), duration.
// Posts to BUILD's startSupport action, which re-checks platform admin, logs, sets the session and opens the workspace.
import { useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { startSupportSession } from "./actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fieldCls } from "./action-dialog";

type Opt = { tenantId: string; tenantName: string; workspaces: { id: string; name: string }[] };
const MIN = 20, MIN2 = 10;

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant="primary" size="lg" disabled={disabled || pending} className="w-full sm:w-auto">{pending ? "Starting…" : "Start session and open workspace"}</Button>;
}

export function SupportForm({ options, initialWs, error, blocked }: { options: Opt[]; initialWs?: string; error?: string; blocked?: string }) {
  const id = useId();
  const startT = options.find((o) => o.workspaces.some((w) => w.id === initialWs))?.tenantId ?? options[0].tenantId;
  const [tenant, setTenant] = useState(startT);
  const wsList = options.find((o) => o.tenantId === tenant)?.workspaces ?? [];
  const [ws, setWs] = useState(initialWs && wsList.some((w) => w.id === initialWs) ? initialWs : wsList[0]?.id ?? "");
  const [mode, setMode] = useState<"read_only" | "read_write">("read_only");
  const [reason, setReason] = useState("");
  const [reason2, setReason2] = useState("");
  const [minutes, setMinutes] = useState("30");
  const len = reason.trim().length, len2 = reason2.trim().length;
  const reasonOk = len >= MIN, reason2Ok = mode === "read_only" || len2 >= MIN2;
  const reasonErr = error === "reason", reason2Err = error === "reason2";
  return (
    <form action={startSupportSession} className="space-y-4">
      <input type="hidden" name="ws" value={ws} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-t`} className="mb-1 block text-[12px] font-medium text-ink-2">Tenant</label>
          <select id={`${id}-t`} value={tenant} onChange={(e) => { setTenant(e.target.value); setWs(options.find((o) => o.tenantId === e.target.value)?.workspaces[0]?.id ?? ""); }} className={fieldCls}>
            {options.map((o) => <option key={o.tenantId} value={o.tenantId}>{o.tenantName}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-w`} className="mb-1 block text-[12px] font-medium text-ink-2">Workspace</label>
          <select id={`${id}-w`} value={ws} onChange={(e) => setWs(e.target.value)} className={fieldCls}>
            {wsList.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="mb-1 text-[12px] font-medium text-ink-2">Mode</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {([["read_only", "Read-only", "Acts as Viewer. Pages a Viewer cannot open stay closed."], ["read_write", "Read-write", "Acts as Owner minus the never-list. Needs a second reason."]] as const).map(([v, l, d]) => (
            <label key={v} className={cn("flex cursor-pointer gap-2.5 rounded-sm border p-3 transition-colors duration-150", mode === v ? "border-accent bg-accent-soft/60" : "border-line-strong bg-surface hover:bg-paper")}>
              <input type="radio" name="mode" value={v} checked={mode === v} onChange={() => setMode(v)} className="mt-0.5 accent-[var(--accent)]" />
              <span><span className="block text-[13px] font-medium text-ink">{l}{v === "read_only" && <span className="ml-1.5 text-[11px] font-normal text-ink-3">default</span>}</span><span className="block text-[12px] text-ink-3">{d}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${id}-r`} className="mb-1 block text-[12px] font-medium text-ink-2">Reason (shown to the workspace owner)</label>
        <textarea id={`${id}-r`} name="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={MIN}
          aria-invalid={reasonErr && !reasonOk} aria-describedby={`${id}-rc${reasonErr ? ` ${id}-re` : ""}`}
          placeholder="Ticket #142: CSV import failing for Madurai leads" className={cn(fieldCls, "h-auto py-2 leading-5")} />
        <div className="mt-1 flex justify-between gap-3 text-[12px]">
          <span className="text-ink-3">Minimum {MIN} characters. Name the ticket and the symptom.</span>
          <span id={`${id}-rc`} aria-live="polite" className={cn("shrink-0 num", reasonOk ? "text-success" : "text-ink-3")}>{len} / {MIN}{reasonOk ? " · ok" : ""}</span>
        </div>
        {reasonErr && <p id={`${id}-re`} role="alert" className="mt-1 text-[12px] text-danger">The reason must be at least {MIN} characters.</p>}
      </div>

      {mode === "read_write" && (
        <div>
          <label htmlFor={`${id}-r2`} className="mb-1 block text-[12px] font-medium text-ink-2">Why read-only is not enough</label>
          <input id={`${id}-r2`} name="reason2" value={reason2} onChange={(e) => setReason2(e.target.value)} required minLength={MIN2}
            aria-invalid={reason2Err && !reason2Ok} aria-describedby={`${id}-r2c${reason2Err ? ` ${id}-r2e` : ""}`}
            placeholder="Owner asked us to fix 2 rejected rows" className={fieldCls} />
          <div className="mt-1 flex justify-between gap-3 text-[12px] text-ink-3">
            <span>Minimum {MIN2} characters. Logged with the session.</span>
            <span id={`${id}-r2c`} aria-live="polite" className={cn("shrink-0 num", len2 >= MIN2 && "text-success")}>{len2} / {MIN2}</span>
          </div>
          {reason2Err && <p id={`${id}-r2e`} role="alert" className="mt-1 text-[12px] text-danger">Read-write needs a second reason of at least {MIN2} characters.</p>}
        </div>
      )}

      <fieldset>
        <legend className="mb-1 text-[12px] font-medium text-ink-2">Duration</legend>
        <div role="radiogroup" className="inline-flex h-9 items-center rounded-sm border border-line-strong bg-paper-2 p-0.5">
          {["15", "30", "60"].map((m) => (
            <label key={m} className={cn("flex h-full cursor-pointer items-center rounded-[4px] px-3 text-[12px] font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", minutes === m ? "bg-surface text-ink shadow-1" : "text-ink-3 hover:text-ink")}>
              <input type="radio" name="minutes" value={m} checked={minutes === m} onChange={() => setMinutes(m)} className="sr-only" />{m} min
            </label>
          ))}
        </div>
        <p className="mt-1 text-[12px] text-ink-3">Sessions expire on time and cannot be extended. Start a new one with a new reason.</p>
      </fieldset>

      {error === "rpc" && <p role="alert" className="rounded-sm border border-danger/25 bg-danger-soft px-3 py-2 text-[12px] text-danger">start_support_session was refused by the database. Check that your MFA session (aal2) is still valid.</p>}
      {error === "role" && <p role="alert" className="rounded-sm border border-danger/25 bg-danger-soft px-3 py-2 text-[12px] text-danger">Your platform role cannot open support sessions.</p>}
      {error === "ws" && <p role="alert" className="rounded-sm border border-danger/25 bg-danger-soft px-3 py-2 text-[12px] text-danger">Choose a workspace from the list.</p>}
      {blocked && <p role="status" className="rounded-sm border border-warn/40 bg-warn-soft px-3 py-2 text-[12px] text-warn-ink">{blocked}</p>}
      <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:items-center">
        <Submit disabled={!ws || !reasonOk || !reason2Ok || !!blocked} />
        <span className="text-[12px] text-ink-3">The owner is notified. An amber banner shows in the workspace until the session ends.</span>
      </div>
    </form>
  );
}
