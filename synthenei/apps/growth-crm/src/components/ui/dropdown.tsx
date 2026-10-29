"use client";
import * as M from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export function MenuContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <M.Portal>
      <M.Content align={align} sideOffset={6} className={cn("z-50 min-w-48 rounded-md border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-[pop_150ms_ease-out]", className)}>
        {children}
      </M.Content>
    </M.Portal>
  );
}
export function MenuItem({ children, onSelect, disabled, className }: { children: ReactNode; onSelect?: () => void; disabled?: boolean; className?: string }) {
  return (
    <M.Item disabled={disabled} onSelect={onSelect} className={cn("flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-[13px] text-ink outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-paper-2 [&_svg]:size-4 [&_svg]:text-ink-3", className)}>
      {children}
    </M.Item>
  );
}
export const MenuSep = () => <M.Separator className="my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <M.Label className="px-2 pb-1 pt-1.5 text-12 font-medium uppercase tracking-wide text-ink-3">{children}</M.Label>;
