"use client";
import * as T from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function Tip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root delayDuration={200}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 max-w-64 rounded-sm bg-navy-950 px-2.5 py-1.5 text-[12px] leading-4 text-navy-ink shadow-pop data-[state=delayed-open]:animate-in">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
export const TipProvider = T.Provider;
