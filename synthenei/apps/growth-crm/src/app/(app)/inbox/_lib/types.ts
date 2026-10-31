// View models shared by the server page and the client component.
import type { Verdict } from "../../accounts/_components/perms";

export type Ch = "whatsapp" | "email" | "linkedin";
export type ConvStatus = "open" | "snoozed" | "closed";
export type Msg = {
  id: string; from: "lead" | "us" | "note"; at: string; body: string;
  status?: "read" | "delivered" | "sent" | "simulated" | "queued" | "failed"; author: string; template?: string;
};
export type InboxConv = {
  id: string; channel: Ch; subject: string; unread: number; lastAt: string; messages: Msg[];
  draft: { en: string; ta: string | null; rationale: string[]; basedOn: string; needsReview: string | null };
  lead: { id: string; name: string; first: string; title: string; stage: string; score: number; ownerId: string; ownerName: string; consent: { followup: boolean; marketing: boolean; whatsapp: boolean; at: string }; phone: string; email: string };
  firm: { id: string; name: string; district: string; lawyers: number } | null;
  deal: { id: string; stage: string; value: number; plan: string; seats: number } | null;
  windowLeftH: number | null; mine: boolean; reply: Verdict;
  /** real sessions only */
  version?: number; status?: ConvStatus; assigneeId?: string | null;
};
/** Approved templates (real sessions): the body is shown as a preview; the server re-reads it when sending. */
export type TemplateOpt = { id: string; name: string; channel: Ch; body: string; language: string };
export type InboxMode = "demo" | "real";
