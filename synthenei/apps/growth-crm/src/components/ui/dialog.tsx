"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;
export function DialogContent({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-navy-950/45 data-[state=open]:animate-[fade_150ms_ease-out]" />
      <D.Content className={cn("fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-md border border-line bg-surface p-5 shadow-pop focus:outline-none data-[state=open]:animate-[pop_180ms_ease-out]", className)}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <D.Title className="text-[15px] font-semibold text-ink">{title}</D.Title>
            {description && <D.Description className="mt-1 text-[13px] text-ink-2">{description}</D.Description>}
          </div>
          <D.Close className="rounded-sm p-1 text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="Close"><X className="size-4" /></D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
