"use client";
import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Groups secondary widgets so a phone sees a short page: the group is collapsed behind a 44px toggle (all content is still one tap away).
 * From lg up the wrapper is `display: contents`, so the children sit in the parent grid exactly as before and the toggle is not shown. */
export function PhoneCollapse({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="order-last flex flex-col gap-4 lg:contents">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-line bg-surface px-4 text-left shadow-1 lg:hidden">
        <span><span className="block text-[14px] font-semibold text-ink">{title}</span>{hint && <span className="block text-[12px] text-ink-3">{hint}</span>}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div id={id} className={cn(open ? "flex" : "hidden", "flex-col gap-4 lg:contents")}>{children}</div>
    </div>
  );
}
