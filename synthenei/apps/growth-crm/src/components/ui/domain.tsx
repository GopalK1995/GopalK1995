"use client";
// Small domain-specific display atoms. Client component so stage labels follow the active tenant vocabulary.
import { Globe, Mail, MessageCircle, Search, UserRoundPlus, CalendarDays } from "lucide-react";
import type { Channel, DealStage, LeadStage } from "@/lib/data/types";
import { CHANNEL_LABEL } from "@/lib/data/metrics";
import { useVocab } from "@/components/shell/providers";
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

const LEAD_TONE: Record<LeadStage, "neutral" | "accent" | "success" | "danger" | "warn" | "outline"> = {
  new: "outline", contacted: "neutral", qualified: "neutral", demo_booked: "accent", demo_done: "accent", proposal: "warn", won: "success", lost: "danger",
};
export const LeadStageBadge = ({ stage }: { stage: LeadStage }) => <Badge tone={LEAD_TONE[stage]}>{useVocab().leadStage[stage]}</Badge>;
const DEAL_TONE: Record<DealStage, "neutral" | "accent" | "success" | "danger" | "warn" | "outline"> = {
  discovery: "outline", demo_scheduled: "neutral", demo_done: "accent", proposal: "accent", negotiation: "warn", won: "success", lost: "danger",
};
export const DealStageBadge = ({ stage }: { stage: DealStage }) => <Badge tone={DEAL_TONE[stage]}>{useVocab().dealStage[stage]}</Badge>;
