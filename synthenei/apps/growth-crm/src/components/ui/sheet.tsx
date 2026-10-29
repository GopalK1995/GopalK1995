"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;
/** Right-hand drawer, the one raised surface while open. 200 ms slide, instant under reduced motion (see globals.css). */
export function SheetContent({ title, description, children, side = "right", className }: { title: ReactNode; description?: ReactNode; children: ReactNode; side?: "right" | "left"; className?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-navy-950/45 data-[state=open]:animate-[fade_150ms_ease-out]" />
      <D.Content className={cn("sheet-content fixed inset-y-0 z-50 flex w-[min(28rem,100vw)] flex-col border-line bg-surface shadow-pop focus:outline-none", side === "right" ? "right-0 border-l" : "left-0 border-r", className)} data-side={side}>
        <header className="zone-work flex items-start justify-between gap-4 border-b border-line">
          <div className="min-w-0">
            <D.Title className="text-15 font-bold tracking-[-0.015em] text-ink">{title}</D.Title>
            {description ? <D.Description className="mt-1 text-13 text-ink-2">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="rounded-chip p-1 text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="Close"><X className="size-3.5" strokeWidth={1.75} /></D.Close>
        </header>
        <div className="zone-work min-h-0 flex-1 overflow-y-auto">{children}</div>
      </D.Content>
    </D.Portal>
  );
}
