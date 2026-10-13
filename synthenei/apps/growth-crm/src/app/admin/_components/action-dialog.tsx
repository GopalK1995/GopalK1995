"use client";
// One dialog pattern for every admin write: labelled fields, inline errors tied with aria-describedby,
// server action re-checks platform admin, result announced as a toast.
import { useId, useState, useTransition, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { ActionResult } from "./actions";

export const fieldCls = "h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink-3 focus:border-ring aria-[invalid=true]:border-danger";
export type Field = {
  name: string; label: string; type?: "text" | "email" | "number" | "select" | "hidden"; placeholder?: string; defaultValue?: string;
  options?: { value: string; label: string }[]; hint?: ReactNode; mono?: boolean; autoComplete?: string;
};

export function ActionDialog({ trigger, triggerVariant = "secondary", triggerSize = "md", title, description, fields, submit, action, danger, icon, triggerClassName, children }: {
  trigger: ReactNode; triggerVariant?: ButtonProps["variant"]; triggerSize?: ButtonProps["size"]; title: string; description?: ReactNode; fields: Field[];
  submit: string; action: (f: FormData) => Promise<ActionResult>; danger?: boolean; icon?: ReactNode; triggerClassName?: string; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<{ field?: string; message: string } | null>(null);
  const [pending, start] = useTransition();
  const id = useId();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await action(fd);
      if (!r.ok) { setErr({ field: r.field, message: r.message }); return; }
      setErr(null); setOpen(false); toast(r.message, r.sub);
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setErr(null); }}>
      <DialogTrigger asChild><Button variant={triggerVariant} size={triggerSize} className={triggerClassName}>{icon}{trigger}</Button></DialogTrigger>
      <DialogContent title={title} description={description}>
        <form onSubmit={onSubmit} noValidate className="space-y-3">
          {children}
          {fields.map((f) => {
            if (f.type === "hidden") return <input key={f.name} type="hidden" name={f.name} value={f.defaultValue} />;
            const fid = `${id}-${f.name}`, bad = err?.field === f.name;
            const describedBy = [f.hint ? `${fid}-hint` : "", bad ? `${fid}-err` : ""].filter(Boolean).join(" ") || undefined;
            return (
              <div key={f.name}>
                <label htmlFor={fid} className="mb-1 block text-[12px] font-medium text-ink-2">{f.label}</label>
                {f.type === "select" ? (
                  <select id={fid} name={f.name} defaultValue={f.defaultValue} aria-invalid={bad} aria-describedby={describedBy} className={fieldCls}>
                    {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <input id={fid} name={f.name} type={f.type ?? "text"} defaultValue={f.defaultValue} placeholder={f.placeholder} autoComplete={f.autoComplete ?? "off"}
                    aria-invalid={bad} aria-describedby={describedBy} className={cn(fieldCls, f.mono && "font-mono text-[13px]")} />
                )}
                {f.hint && <p id={`${fid}-hint`} className="mt-1 text-[12px] text-ink-3">{f.hint}</p>}
                {bad && <p id={`${fid}-err`} role="alert" className="mt-1 text-[12px] text-danger">{err.message}</p>}
              </div>
            );
          })}
          {err && !fields.some((f) => f.name === err.field) && <p role="alert" className="rounded-sm border border-danger/25 bg-danger-soft px-3 py-2 text-[12px] text-danger">{err.message}</p>}
          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <DialogClose asChild><Button type="button" variant="ghost">Cancel</Button></DialogClose>
            <Button type="submit" variant={danger ? "danger" : "primary"} disabled={pending}>{pending ? "Checking…" : submit}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Small button that runs an action immediately and toasts the result (no fields). */
export function ActionButton({ action, data, children, variant = "secondary", size = "sm", className }: {
  action: (f: FormData) => Promise<ActionResult>; data: Record<string, string>; children: ReactNode; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; className?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button variant={variant} size={size} className={className} disabled={pending} onClick={() => start(async () => {
      const fd = new FormData(); Object.entries(data).forEach(([k, v]) => fd.set(k, v));
      const r = await action(fd); toast(r.message, r.sub);
    })}>{children}</Button>
  );
}
