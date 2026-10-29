import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, FlaskConical, Radio, WifiOff, XCircle } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const chipVariants = cva("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-chip border px-1.5 text-12 font-medium leading-none [&_svg]:size-3 [&_svg]:shrink-0", {
  variants: {
    tone: {
      neutral: "border-line-strong bg-paper-2 text-ink-2",
      accent: "state-accent",
      info: "state-info",
      warn: "state-warn",
      success: "state-success",
      danger: "state-danger",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export type ChipTone = NonNullable<VariantProps<typeof chipVariants>["tone"]>;

/** Small label. Radius is the chip role (4 px), never a pill. State tones use a 12% fill and a 50% border. */
export function Chip({ className, tone, icon, children, ...p }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof chipVariants> & { icon?: ReactNode }) {
  return <span className={cn(chipVariants({ tone }), className)} {...p}>{icon}{children}</span>;
}

export type LiveStatus = "live" | "stale" | "offline" | "connected" | "sandbox" | "needs_attention" | "error" | "disconnected" | "not_configured";
const MAP: Record<LiveStatus, { tone: ChipTone; label: string; Icon: typeof Radio }> = {
  live: { tone: "success", label: "Live", Icon: Radio },
  stale: { tone: "warn", label: "Stale", Icon: AlertTriangle },
  offline: { tone: "danger", label: "Offline", Icon: WifiOff },
  connected: { tone: "success", label: "Connected", Icon: CheckCircle2 },
  sandbox: { tone: "warn", label: "Sandbox", Icon: FlaskConical },
  needs_attention: { tone: "warn", label: "Needs attention", Icon: AlertTriangle },
  error: { tone: "danger", label: "Error", Icon: XCircle },
  disconnected: { tone: "neutral", label: "Disconnected", Icon: CircleSlash },
  not_configured: { tone: "neutral", label: "Not configured", Icon: CircleDashed },
};
/** Sync and connector status. Always icon plus word, never colour alone. */
export function LiveStatusChip({ status, label, className }: { status: LiveStatus; label?: string; className?: string }) {
  const s = MAP[status];
  return <Chip tone={s.tone} className={className} data-status={status} icon={<s.Icon aria-hidden />}>{label ?? s.label}</Chip>;
}
