"use client";
// Org-admin policy editor: what this tenant's org admins may configure. Super admin edits (reason required, audited);
// every other platform role sees the same form read-only with the reason. Empty number or "all" list = no limit from the platform.
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ActionResult } from "./actions";
import { fieldCls } from "./action-dialog";
import type { OrgPolicy } from "../_lib/repo";

const BOOLS = [
  { key: "allowCustomRoles", wire: "allow_custom_roles", label: "Custom roles", hint: "Org admins can clone and edit roles." },
  { key: "allowCustomObjects", wire: "allow_custom_objects", label: "Custom objects and fields", hint: "Org admins can add objects beyond the preset." },
  { key: "allowApiKeys", wire: "allow_api_keys", label: "API keys", hint: "Org admins can create REST API keys." },
  { key: "allowWebhooks", wire: "allow_webhooks", label: "Outbound webhooks", hint: "Org admins can add webhook endpoints." },
  { key: "allowByok", wire: "allow_byok", label: "Bring your own AI key", hint: "Org admins can store their own model key." },
] as const;
const NUMS = [
  { key: "maxSeats", wire: "max_seats", label: "Seat cap" },
  { key: "maxWorkspaces", wire: "max_workspaces", label: "Workspace cap" },
  { key: "maxCustomFields", wire: "max_custom_fields", label: "Custom field cap" },
] as const;

export function PolicyEditor({ tenantSlug, policy, modules, connectors, canEdit, action }: {
  tenantSlug: string; policy: OrgPolicy; modules: string[]; connectors: { id: string; name: string }[]; canEdit: boolean;
  action: (tenantSlug: string, patch: unknown, reason: string) => Promise<ActionResult>;
}) {
  const id = useId();
  const [bools, setBools] = useState<Record<string, boolean>>(() => Object.fromEntries(BOOLS.map((b) => [b.wire, policy[b.key]])));
  const [nums, setNums] = useState<Record<string, string>>(() => Object.fromEntries(NUMS.map((x) => [x.wire, policy[x.key] == null ? "" : String(policy[x.key])])));
  const [mods, setMods] = useState<string[] | null>(policy.allowedModules);
  const [conns, setConns] = useState<string[] | null>(policy.allowConnectors);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const lockReason = "Needs platform.policies.manage (super admin)";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const patch: Record<string, unknown> = { ...bools };
    for (const x of NUMS) { const v = nums[x.wire].trim(); patch[x.wire] = v === "" ? null : Number(v); }
    patch.allowed_modules = mods;
    patch.allow_connectors = conns;
    start(async () => {
      const r = await action(tenantSlug, patch, reason);
      if (!r.ok) { setErr({ field: r.field, message: r.message }); return; }
      setErr(null); setReason(""); toast(r.message, r.sub);
    });
  };
  const toggle = (list: string[] | null, all: string[], v: string): string[] | null => {
    const cur = list ?? all;
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    return next.length === all.length ? null : next;
  };
  const allConns = connectors.map((c) => c.id);
  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-describedby={err ? `${id}-err` : undefined}>
      {!canEdit && <p role="status" className="rounded-sm border border-line-strong bg-paper-2 px-3 py-2 text-[13px] text-ink-2"><strong className="font-semibold text-ink">Read only for your role.</strong> Only a super admin can change what org admins may configure.</p>}
      {!policy.persisted && <p className="text-[12px] text-ink-3">No policy row yet: defaults apply (everything allowed except bring-your-own AI key, no caps). Saving creates it.</p>}
      <fieldset disabled={!canEdit} className="space-y-2">
        <legend className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">What org admins may do</legend>
        {BOOLS.map((b) => (
          <label key={b.wire} className="flex items-start gap-2.5 text-[13px]">
            <input type="checkbox" checked={bools[b.wire]} onChange={(e) => setBools({ ...bools, [b.wire]: e.target.checked })} className="mt-0.5 accent-[var(--accent)]" />
            <span><span className="font-medium text-ink">{b.label}</span><span className="block text-[12px] text-ink-3">{b.hint}</span></span>
          </label>
        ))}
      </fieldset>
      <fieldset disabled={!canEdit} className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Caps (empty = no limit)</legend>
        {NUMS.map((x) => (
          <div key={x.wire}>
            <label htmlFor={`${id}-${x.wire}`} className="mb-1 block text-[12px] font-medium text-ink-2">{x.label}</label>
            <input id={`${id}-${x.wire}`} inputMode="numeric" value={nums[x.wire]} onChange={(e) => setNums({ ...nums, [x.wire]: e.target.value })} aria-invalid={err?.field === x.wire}
              className={cn(fieldCls, "num")} placeholder="No limit" />
          </div>
        ))}
      </fieldset>
      <fieldset disabled={!canEdit}>
        <legend className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Modules available to org admins {mods === null && <span className="normal-case tracking-normal text-ink-3">(all)</span>}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {modules.map((m) => (
            <label key={m} className="flex items-center gap-1.5 text-[13px]">
              <input type="checkbox" checked={mods === null || mods.includes(m)} onChange={() => setMods(toggle(mods, modules, m))} className="accent-[var(--accent)]" />{m}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={!canEdit}>
        <legend className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-3">Connectors org admins may connect {conns === null && <span className="normal-case tracking-normal text-ink-3">(all)</span>}</legend>
        {connectors.length ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {connectors.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-[13px]">
                <input type="checkbox" checked={conns === null || conns.includes(c.id)} onChange={() => setConns(toggle(conns, allConns, c.id))} className="accent-[var(--accent)]" />{c.name}
              </label>
            ))}
          </div>
        ) : <p className="text-[12px] text-ink-3">The connector catalogue is empty.</p>}
      </fieldset>
      {canEdit && (
        <div className="border-t border-line pt-4">
          <label htmlFor={`${id}-reason`} className="mb-1 block text-[12px] font-medium text-ink-2">Reason (audited, 8+ characters)</label>
          <input id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={err?.field === "reason"} className={fieldCls} placeholder="e.g. Pilot contract excludes API access until renewal" />
        </div>
      )}
      {err && <p id={`${id}-err`} role="alert" className="text-[12px] text-danger">{err.message}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={!canEdit || pending} disabledReason={canEdit ? undefined : lockReason}>{pending ? "Saving…" : "Save policy"}</Button>
        {policy.updatedAt && <span className="text-[12px] text-ink-3">Last changed {new Date(policy.updatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST</span>}
      </div>
    </form>
  );
}
