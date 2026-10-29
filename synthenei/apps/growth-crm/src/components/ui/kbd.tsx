import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Kbd({ className, ...p }: HTMLAttributes<HTMLElement>) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-chip border border-line-strong bg-paper-2 px-1 font-mono text-12 font-medium leading-none text-ink-2", className)} {...p} />;
}
