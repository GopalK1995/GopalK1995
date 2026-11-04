"use client";
// Small domain-specific display atoms. Client component so stage labels follow the active tenant vocabulary.
import { Globe, Mail, MessageCircle, Search, UserRoundPlus, CalendarDays } from "lucide-react";
import type { Channel, DealStage, LeadStage } from "@/lib/data/types";
import { CHANNEL_LABEL } from "@/lib/data/metrics";
import { useSession, useVocab } from "@/components/shell/providers";
import { LEGACY_TONE, type BadgeTone } from "@/lib/config/stage-tone";
import { prettyStageKey } from "@/lib/vertical";
import { cn } from "@/lib/utils";
import { Badge } from "./badge";

/** Channel marker: plain monogram or lucide glyph in a 1px box. No vendor logos (white-label). */
export function ChannelMark({ channel, withLabel = false, className }: { channel: Channel; withLabel?: boolean; className?: string }) {
  const mono: Partial<Record<Channel, string>> = { linkedin: "in", meta: "f", google_ads: "G" };
  const Icon = channel === "whatsapp" ? MessageCircle : channel === "email" ? Mail : channel === "organic" ? Search : channel === "referral" ? UserRoundPlus : channel === "event" ? CalendarDays : Globe;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12px] text-ink-2", className)} title={CHANNEL_LABEL[channel]}>
      <span className="grid size-5 shrink-0 place-items-center rounded-[4px] border border-line bg-surface text-[10px] font-bold text-ink-2" aria-hidden>
        {mono[channel] ?? <Icon className="size-3" />}
      </span>
      {withLabel && CHANNEL_LABEL[channel]}
    </span>
  );
}

/** Label and tone come from the tenant config (stage keys are data); unknown keys fall back to a readable key and a neutral tone. */
function StageBadge({ kind, stage }: { kind: "lead" | "deal"; stage: string }) {
  const v = useVocab(), session = useSession();
  const labels = (kind === "lead" ? v.leadStage : v.dealStage) as Record<string, string>;
  const tone = (session.tenant.stageTone?.[kind]?.[stage] ?? LEGACY_TONE[kind][stage] ?? "neutral") as BadgeTone;
  return <Badge tone={tone}>{labels[stage] ?? prettyStageKey(stage)}</Badge>;
}
export const LeadStageBadge = ({ stage }: { stage: LeadStage }) => <StageBadge kind="lead" stage={stage} />;
export const DealStageBadge = ({ stage }: { stage: DealStage }) => <StageBadge kind="deal" stage={stage} />;
