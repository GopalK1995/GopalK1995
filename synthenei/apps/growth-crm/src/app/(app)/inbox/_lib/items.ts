// Builds the inbox view models for a real session from raw rows + the workspace's leads/accounts/deals/team.
import type { Account, Deal, Lead, TeamMember } from "@/lib/data/types";
import type { Vocab } from "@/lib/vertical";
import type { Verdict } from "../../accounts/_components/perms";
import type { Ch, ConvStatus, InboxConv, Msg, TemplateOpt } from "./types";
import type { Row } from "./reads";
import { leftHours, windowState } from "./window";

const CHANNELS: Ch[] = ["whatsapp", "email", "linkedin"];
const s = (v: unknown, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
const STATUSES: ConvStatus[] = ["open", "snoozed", "closed"];

export interface BuildArgs {
  raw: { convs: Row[]; msgs: Row[]; templates: Row[] };
  leads: Lead[]; accounts: Account[]; deals: Deal[]; team: TeamMember[];
  v: Vocab; uid: string; now: string; masked: boolean; ownOnly: boolean;
  maskName: (n: string) => string;
  replyFor: (assigneeId: string | null) => Verdict;
}

export function buildRealItems(a: BuildArgs): { items: InboxConv[]; hidden: number; templates: TemplateOpt[] } {
  const nameOf = (id?: string | null) => a.team.find((t) => t.id === id)?.name ?? "Unassigned";
  let hidden = 0;
  const items: InboxConv[] = [];
  for (const c of a.raw.convs) {
    const channel = s(c.channel) as Ch;
    if (!CHANNELS.includes(channel)) { hidden++; continue; }
    const assigneeId = c.assigneeId ? s(c.assigneeId) : null;
    if (a.ownOnly && assigneeId !== a.uid) continue; // rep scope: own conversations (RLS enforces it too)
    const lead = a.leads.find((l) => l.id === c.leadId);
    const acct = lead ? a.accounts.find((x) => x.id === lead.accountId) : undefined;
    const deal = lead ? a.deals.find((d) => d.leadId === lead.id && d.stage !== "won" && d.stage !== "lost") : undefined;
    const name = lead ? (a.masked ? a.maskName(lead.name) : lead.name) : "Unlinked contact";
    const first = name.split(" ")[0];
    const readAt = c.lastReadAt ? s(c.lastReadAt) : "";
    const msgs: Msg[] = a.raw.msgs.filter((m) => m.conversationId === c.id).map((m) => {
      const note = m.isInternalNote === true, inbound = m.direction === "inbound";
      return {
        id: s(m.id), from: note ? "note" : inbound ? "lead" : "us", at: s(m.createdAt), body: s(m.body),
        status: note || inbound ? undefined : (s(m.status) as Msg["status"]), author: inbound ? first : nameOf(s(m.sentBy)).split(" ")[0],
        template: m.templateId ? s(m.templateId) : undefined,
      };
    });
    const unread = msgs.filter((m) => m.from === "lead" && (!readAt || m.at > readAt)).length;
    const w = windowState(channel, c.lastInboundAt ? s(c.lastInboundAt) : null, a.now);
    const status = STATUSES.includes(c.status as ConvStatus) ? (c.status as ConvStatus) : "open";
    items.push({
      id: s(c.id), channel, subject: "", unread, lastAt: s(c.lastMessageAt ?? c.createdAt), messages: msgs,
      draft: { en: "", ta: null, rationale: [], basedOn: "", needsReview: null }, // no AI drafts are stored for real sessions yet
      lead: {
        id: lead?.id ?? "", name, first, title: lead?.title ?? "", stage: lead ? (a.v.leadStage[lead.stage] ?? lead.stage) : "", score: lead?.score ?? 0,
        ownerId: assigneeId ?? lead?.ownerId ?? "", ownerName: nameOf(assigneeId ?? lead?.ownerId),
        consent: lead?.consent ?? { followup: false, marketing: false, whatsapp: false, at: "" },
        phone: a.masked ? "" : lead?.phone ?? "", email: a.masked ? "" : lead?.email ?? "",
      },
      firm: acct ? { id: acct.id, name: acct.name, district: acct.district, lawyers: acct.lawyers } : null,
      deal: deal ? { id: deal.id, stage: a.v.dealStage[deal.stage], value: deal.value, plan: deal.plan, seats: deal.seats } : null,
      windowLeftH: leftHours(w), mine: assigneeId === a.uid, reply: a.replyFor(assigneeId),
      version: typeof c.version === "number" ? c.version : undefined, status, assigneeId,
    });
  }
  const templates: TemplateOpt[] = a.raw.templates
    .filter((t) => CHANNELS.includes(s(t.channel) as Ch))
    .map((t) => ({ id: s(t.id), name: s(t.name), channel: s(t.channel) as Ch, body: s(t.body), language: s(t.language, "en") }));
  return { items, hidden, templates };
}
