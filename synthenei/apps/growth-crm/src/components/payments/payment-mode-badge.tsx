// Mode label for a Razorpay connection: "Showcase" (mock gateway, no network), "Test mode" (rzp_test_ keys) or "Live". Always icon plus
// word, never colour alone. Labels come from the `razorpay` i18n namespace (showcase / testMode / liveMode); the caller passes them in.
import { CheckCircle2, FlaskConical, Sparkles } from "lucide-react";
import { Chip } from "@/components/ui/chip";

export type PaymentMode = "showcase" | "test" | "live";
export interface PaymentModeLabels { showcase: string; test: string; live: string }

/** Derives the mode from the connection facts: the showcase flag wins, then the key id prefix. */
export function paymentModeOf(i: { showcase: boolean; keyId?: string | null }): PaymentMode {
  if (i.showcase) return "showcase";
  return i.keyId?.startsWith("rzp_live_") ? "live" : "test";
}

export function PaymentModeBadge({ mode, labels, className }: { mode: PaymentMode; labels: PaymentModeLabels; className?: string }) {
  if (mode === "live") return <Chip tone="success" icon={<CheckCircle2 aria-hidden />} className={className} data-payment-mode="live">{labels.live}</Chip>;
  if (mode === "test") return <Chip tone="warn" icon={<FlaskConical aria-hidden />} className={className} data-payment-mode="test">{labels.test}</Chip>;
  return <Chip tone="accent" icon={<Sparkles aria-hidden />} className={className} data-payment-mode="showcase">{labels.showcase}</Chip>;
}
