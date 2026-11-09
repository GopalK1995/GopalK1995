// Status of a payments row (created | pending | paid | failed | refunded | cancelled). Icon plus word; labels from razorpay `status.*`.
import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed, CircleSlash, Clock, RotateCcw, XCircle } from "lucide-react";
import { Chip, type ChipTone } from "@/components/ui/chip";

export type PaymentStatus = "created" | "pending" | "paid" | "failed" | "refunded" | "cancelled";
const MAP: Record<PaymentStatus, { tone: ChipTone; icon: ReactNode }> = {
  created: { tone: "neutral", icon: <CircleDashed aria-hidden /> },
  pending: { tone: "info", icon: <Clock aria-hidden /> },
  paid: { tone: "success", icon: <CheckCircle2 aria-hidden /> },
  failed: { tone: "danger", icon: <XCircle aria-hidden /> },
  refunded: { tone: "warn", icon: <RotateCcw aria-hidden /> },
  cancelled: { tone: "neutral", icon: <CircleSlash aria-hidden /> },
};

export function PaymentStatusChip({ status, labels, className }: { status: PaymentStatus; labels: Record<PaymentStatus, string>; className?: string }) {
  const m = MAP[status];
  return <Chip tone={m.tone} icon={m.icon} className={className} data-payment-status={status}>{labels[status]}</Chip>;
}
