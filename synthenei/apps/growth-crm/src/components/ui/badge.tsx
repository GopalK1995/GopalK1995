import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] px-1.5 h-5 text-[11px] font-medium leading-none [&_svg]:size-3", {
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

/** Status chip for integrations and demo surfaces. Showcase = neutral slate, dashed outline (reads as a label, not success). */
export type Status = "showcase" | "connected" | "needs_attention" | "error" | "not_configured" | "sample";
const STATUS: Record<Status, { tone: NonNullable<VariantProps<typeof badgeVariants>["tone"]>; label: string }> = {
  showcase: { tone: "showcase", label: "Showcase" }, connected: { tone: "success", label: "Connected" }, needs_attention: { tone: "warn", label: "Needs attention" },
  error: { tone: "danger", label: "Error" }, not_configured: { tone: "outline", label: "Not configured" }, sample: { tone: "showcase", label: "Sample data" },
};
export function StatusChip({ status, label, className }: { status: Status; label?: string; className?: string }) {
  const s = STATUS[status];
  return <Badge tone={s.tone} className={className}>{label ?? s.label}</Badge>;
}
