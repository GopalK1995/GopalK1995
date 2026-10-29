"use client";
import * as T from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/** Self-contained tooltip: carries its own provider so it also works where no TipProvider is mounted. */
export function Tip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Provider delayDuration={200}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content side={side} sideOffset={6} className="z-50 max-w-64 rounded-chip bg-navy-950 px-2.5 py-1.5 text-12 leading-4 text-navy-ink shadow-pop">
            {content}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
export const TipProvider = T.Provider;
