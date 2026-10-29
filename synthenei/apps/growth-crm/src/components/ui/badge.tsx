import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { LiveStatusChip, type LiveStatus } from "./chip";

export const badgeVariants = cva("inline-flex items-center gap-1 whitespace-nowrap rounded-chip px-1.5 h-5 text-12 font-medium leading-none [&_svg]:size-3", {
  variants: {
    tone: {
      neutral: "bg-paper-2 text-ink-2 ring-1 ring-inset ring-line",
      accent: "bg-accent-soft text-accent-strong ring-1 ring-inset ring-accent/20",
      success: "bg-success-soft text-success ring-1 ring-inset ring-success/20",
      warn: "bg-warn-soft text-warn-ink ring-1 ring-inset ring-warn/25",
      danger: "bg-danger-soft text-danger ring-1 ring-inset ring-danger/20",
      navy: "bg-navy-900 text-navy-ink",
      outline: "text-ink-2 ring-1 ring-inset ring-line-strong",
      showcase: "text-ink-2 bg-surface border border-dashed border-ink-3/60",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export function Badge({ className, tone, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />;
}

/** Status chip for integrations, sync and demo surfaces. Connector and live/stale/offline states render with an icon (see chip.tsx). */
export type Status = "showcase" | "sample" | LiveStatus;
export function StatusChip({ status, label, className }: { status: Status; label?: string; className?: string }) {
  if (status === "showcase" || status === "sample") return <Badge tone="showcase" className={className}>{label ?? (status === "sample" ? "Sample data" : "Showcase")}</Badge>;
  return <LiveStatusChip status={status} label={label} className={className} />;
}
