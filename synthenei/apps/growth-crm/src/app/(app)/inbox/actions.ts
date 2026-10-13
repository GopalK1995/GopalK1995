"use server";
// Inbox mutations (Showcase). Re-checks role, ownership, support session, WhatsApp 24-hour window and consent on the
// server. Nothing is ever sent: in demo every message gets status 'simulated'.
import { pageCtx } from "@/lib/data/context";
import { allowed, deniedReason, type ActionResult } from "../accounts/_components/perms";

const WINDOW_H = 24;
async function load(convId: string) {
  const c = await pageCtx();
  const [convs, leads] = await Promise.all([c.ds.conversations(), c.ds.leads()]);
  const conv = c.scope.conversations(convs, leads).find((x) => x.id === convId);
  const lead = conv ? leads.find((l) => l.id === conv.leadId) : undefined;
  return { ...c, conv, lead };
}

export type SendInput = { convId: string; kind: "reply" | "template" | "note"; body: string; templateId?: string; fromDraft?: boolean; edited?: boolean; lang?: "en" | "ta"; reviewed?: boolean };

export async function sendMessage(input: SendInput): Promise<ActionResult & { status?: "simulated" }> {
  const { conv, lead, role, support, session, now } = await load(input.convId);
  if (!conv || !lead) return { ok: false, message: "Conversation not found in your inbox.", sub: "Nothing was sent." };
  const ctx = { role, support, uid: session.uid, ownerId: lead.ownerId };
  if (!allowed("replyInbox", ctx)) return { ok: false, message: deniedReason("replyInbox", ctx), sub: "Checked on the server; nothing was sent." };
  const body = input.body.trim();
  if (!body) return { ok: false, message: "Write a message or pick a template first." };
  if (input.kind === "note") return { ok: true, message: "Internal note added", sub: "Visible to your team only. Demo: not saved." };

  if (conv.channel === "whatsapp") {
    const lastIn = [...conv.messages].reverse().find((m) => m.from === "lead");
    const hours = lastIn ? (new Date(now).getTime() - new Date(lastIn.at).getTime()) / 3600e3 : Infinity;
    if (!lead.consent.whatsapp) return { ok: false, message: "No WhatsApp consent on file for this contact.", sub: "Record consent before messaging on WhatsApp." };
    if (input.kind === "reply" && hours > WINDOW_H) return { ok: false, message: "The 24-hour WhatsApp window has closed.", sub: "Only approved templates can be sent now (Meta rule)." };
  }
  if (input.fromDraft && conv.aiDraft.needsReview && !input.edited && role !== "owner" && !input.reviewed)
    return { ok: false, message: "This draft makes a contractual commitment.", sub: "It needs Owner or counsel review before it goes out." };

  const what = input.kind === "template" ? `Template ${input.templateId}` : input.fromDraft ? `Reviewed draft${input.edited ? " (edited)" : ""}` : "Reply";
  return {
    ok: true, status: "simulated",
    message: `${what} queued to ${lead.name.split(" ")[0]} on ${conv.channel === "whatsapp" ? "WhatsApp" : conv.channel === "email" ? "email" : "LinkedIn"}`,
    sub: `Showcase: status 'simulated', nothing was sent.${input.fromDraft ? " Logged as draft accepted by you." : ""}`,
  };
}

export async function linkConversation(convId: string, leadId: string): Promise<ActionResult> {
  const { conv, lead, role, support, session, ds } = await load(convId);
  if (!conv || !lead) return { ok: false, message: "Conversation not found in your inbox." };
  const target = await ds.lead(leadId);
  const ctx = { role, support, uid: session.uid, ownerId: target?.ownerId };
  if (!target) return { ok: false, message: "That lead is not in this workspace." };
  if (!allowed("linkConversation", ctx)) return { ok: false, message: deniedReason("linkConversation", ctx) };
  return { ok: true, message: `Conversation linked to ${target.name}`, sub: "Demo: link not saved. Future messages from this number join that lead's timeline." };
}

export async function assignConversation(convId: string, uid: string): Promise<ActionResult> {
  const { conv, role, support, ds } = await load(convId);
  if (!conv) return { ok: false, message: "Conversation not found in your inbox." };
  if (!allowed("assignConversation", { role, support })) return { ok: false, message: deniedReason("assignConversation", { role, support }) };
  const who = (await ds.team()).find((t) => t.id === uid);
  return { ok: true, message: `Assigned to ${who?.name ?? "teammate"}`, sub: "Demo: not saved." };
}

export async function closeConversation(convId: string): Promise<ActionResult> {
  const { conv, lead, role, support, session } = await load(convId);
  if (!conv || !lead) return { ok: false, message: "Conversation not found in your inbox." };
  const ctx = { role, support, uid: session.uid, ownerId: lead.ownerId };
  if (!allowed("replyInbox", ctx)) return { ok: false, message: deniedReason("replyInbox", ctx) };
  return { ok: true, message: "Conversation closed", sub: "Reopens automatically on the next inbound message. Demo: not saved." };
}
