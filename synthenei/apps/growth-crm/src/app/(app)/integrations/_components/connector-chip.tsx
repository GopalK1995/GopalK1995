import { AlertTriangle, Ban, CheckCircle2, CircleDashed, FlaskConical, KeyRound, Link2Off, ShieldQuestion, XCircle, type LucideIcon } from "lucide-react";
import { Chip, type ChipTone } from "@/components/ui/chip";
import type { ChipState } from "@/lib/connectors/core/status";

const LOOK: Record<ChipState, { tone: ChipTone; Icon: LucideIcon }> = {
  connected: { tone: "success", Icon: CheckCircle2 },
  sandbox: { tone: "warn", Icon: FlaskConical },
  needs_attention: { tone: "warn", Icon: AlertTriangle },
  error: { tone: "danger", Icon: XCircle },
  needs_vendor_approval: { tone: "info", Icon: ShieldQuestion },
  needs_client_credentials: { tone: "info", Icon: KeyRound },
  not_configured: { tone: "neutral", Icon: CircleDashed },
  not_available: { tone: "neutral", Icon: Ban },
  available: { tone: "neutral", Icon: CircleDashed },
  disconnected: { tone: "neutral", Icon: Link2Off },
};

/** One chip for every honest state. The label always comes from the caller (i18n); state is paired with an icon and a word. */
export function ConnectorChip({ state, label, title }: { state: ChipState; label: string; title?: string }) {
  const { tone, Icon } = LOOK[state];
  return <Chip tone={tone} icon={<Icon aria-hidden strokeWidth={1.75} />} title={title} data-chip={state}>{label}</Chip>;
}
