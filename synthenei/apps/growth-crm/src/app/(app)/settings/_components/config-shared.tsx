"use client";
// Shared building blocks for the configuration editors (used by Settings -> Configuration and by the admin
// console's tenant Configuration tab). Presentation only: the server action re-checks every write.
import { createContext, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Tip } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Section, TenantConfig } from "@/lib/config/types";

export type ActionRes = { ok: boolean; message: string; detail?: string };
export interface ConfigActions {
  save(patch: unknown, reason?: string): Promise<ActionRes>;
  reset(sections: (keyof TenantConfig)[], reason?: string): Promise<ActionRes>;
  rollback(version: number, reason?: string): Promise<ActionRes>;
}
export type Access = "edit" | { locked: string };
export interface EditorCtx {
  scope: "org" | "platform"; tenantId: string; base: TenantConfig; preset: TenantConfig; savedCopy: string;
  access: Record<Section, Access>; actions: ConfigActions; reason: string;
  /** Modules the org admin may not switch on (outside the plan) and locked ones. */
  moduleLocks: Record<string, string>;
}
const Ctx = createContext<EditorCtx | null>(null);
export const ConfigProvider = ({ value, children }: { value: EditorCtx; children: ReactNode }) => <Ctx.Provider value={value}>{children}</Ctx.Provider>;
export const useCfg = () => { const c = useContext(Ctx); if (!c) throw new Error("outside ConfigProvider"); return c; };

export const inputCls = "h-8 rounded-sm border border-line-strong bg-surface px-2 text-[13px] text-ink outline-none focus:border-ring disabled:border-line disabled:bg-paper-2 disabled:text-ink-2";
export const selectCls = inputCls + " pr-6";

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ink-2", className)}>{label}{children}{hint && <span className="font-normal text-ink-3">{hint}</span>}</label>
  );
}
export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cn("relative h-5 w-9 shrink-0 rounded-full border transition-colors outline-none focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50", checked ? "border-accent bg-accent" : "border-line-strong bg-paper-2")}>
      <span className={cn("absolute top-0.5 size-3.5 rounded-full bg-surface shadow-1 transition-[left]", checked ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

/**
 * One editable section: owns a draft, knows if it is dirty, and saves a patch through the server action.
 * `pick` extracts the section's slice of the full config; `toPatch` turns the draft back into a patch.
 */
export function useSection<T>(pick: (c: TenantConfig) => T, toPatch: (d: T) => unknown, sections: (keyof TenantConfig)[]) {
  const cfg = useCfg(), router = useRouter();
  const saved = useMemo(() => pick(cfg.base), [cfg.base]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<T>(saved);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const run = (fn: () => Promise<ActionRes>, after?: () => void) => start(async () => {
    setError(null);
    if (cfg.scope === "platform" && cfg.reason.trim().length < 8) { setError("Enter a reason of at least 8 characters above. It is recorded in the audit log."); return; }
    const r = await fn();
    if (r.ok) { toast(r.message, r.detail ?? cfg.savedCopy); after?.(); router.refresh(); } else setError(r.message);
  });
  return {
    draft, setDraft, dirty, pending, error, setError,
    save: () => run(() => cfg.actions.save(toPatch(draft), cfg.reason)),
    reset: () => run(() => cfg.actions.reset(sections, cfg.reason), () => setDraft(pick(cfg.preset))),
    discard: () => { setDraft(saved); setError(null); },
  };
}

export interface SecState { dirty: boolean; pending: boolean; error: string | null; save(): void; reset(): void; discard(): void }
export function SaveBar({ s, editable, why, resetLabel = "Reset to preset", noReset }: { s: SecState; editable: boolean; why?: string; resetLabel?: string; noReset?: boolean }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
      <p role="status" className={cn("min-h-5 text-[12px]", s.error ? "text-danger" : "text-ink-3")}>{s.error ?? (s.dirty ? "Unsaved changes" : editable ? "Up to date" : (why ?? "Read only"))}</p>
      <div className="flex flex-wrap items-center gap-2">
        {editable ? (
          <>
            {!noReset && <Button variant="ghost" size="sm" disabled={s.pending} onClick={s.reset}><RotateCcw />{resetLabel}</Button>}
            <Button variant="ghost" size="sm" disabled={!s.dirty || s.pending} onClick={s.discard}>Discard</Button>
            <Button variant="primary" size="sm" disabled={!s.dirty || s.pending} onClick={s.save}>{s.pending ? "Saving" : "Save"}</Button>
          </>
        ) : (
          <Tip content={why ?? "You cannot change this section."}><span tabIndex={0} className="inline-flex"><Button variant="primary" size="sm" disabled>Save</Button></span></Tip>
        )}
      </div>
    </div>
  );
}
export const lockedWhy = (a: Access) => (a === "edit" ? undefined : a.locked);

/** Two-column section layout: editor card + live preview card. */
export function SectionLayout({ title, sub, children, preview, note }: { title: string; sub: string; children: ReactNode; preview: ReactNode; note?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {note && <div className="lg:col-span-12">{note}</div>}
      <Card className="lg:col-span-7"><CardHeader title={title} sub={sub} /><CardBody>{children}</CardBody></Card>
      <Card className="self-start lg:sticky lg:top-20 lg:col-span-5"><CardHeader title="Preview" sub="Updates as you type; nothing is saved until you press Save" /><CardBody>{preview}</CardBody></Card>
    </div>
  );
}
/** Editable list of short strings (rooms, categories). */
export function ListEditor({ items, onChange, max, label, disabled, placeholder }: { items: string[]; onChange: (x: string[]) => void; max: number; label: string; disabled?: boolean; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <input aria-label={`${label} ${i + 1}`} value={it} maxLength={40} disabled={disabled} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} className={cn(inputCls, "min-w-0 flex-1")} />
          <Button size="sm" variant="ghost" disabled={disabled} aria-label={`Remove ${it || label}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      {!items.length && <p className="text-[12px] text-ink-3">{placeholder ?? "None yet."}</p>}
      <div><Button size="sm" disabled={disabled || items.length >= max} onClick={() => onChange([...items, ""])}>Add</Button> <span className="ml-2 text-[12px] text-ink-3">{items.length} of {max}</span></div>
    </div>
  );
}
