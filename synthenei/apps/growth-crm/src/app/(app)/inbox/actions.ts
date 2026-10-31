"use server";
// Inbox mutations.
// Real sessions: assertCan (record-level, rep scope = own conversations) -> repositories with expected versions -> ActionResult.
//   Sends are stored as `queued` after the consent (public.can_contact) and 24-hour window checks; nothing is delivered here
//   (vendor connectors T035/T038 do that). Audit rows and conversation.* / message.* events come from DB triggers (0014).
// Demo sessions never touch Supabase: each action validates and returns what would have happened ("Showcase · simulated").
import { pageCtx } from "@/lib/data/context";
import { vocabFor } from "@/lib/vertical";
import { assertCan } from "@/lib/authz/load";
import { failResult, okResult, runAction, type ActionResult as LibResult } from "@/lib/actions/result";
import { DbError } from "@/lib/db/errors";
import type { ConversationRow } from "@/lib/db/repo/types";
import { allowed, deniedReason } from "../accounts/_components/perms";
import * as P from "./_lib/persist";
import { inboxRepos } from "./_lib/repos";
import { assignSchema, linkSchema, noteSchema, readSchema, sendSchema, statusSchema } from "./_lib/schemas";
import { it } from "./_lib/strings";

const WINDOW_H = 24;
type Ctx = Awaited<ReturnType<typeof pageCtx>>;
const pctx = (ctx: Ctx): P.Ctx => ({ ws: ctx.active.ws.uuid, uid: ctx.session.uid, now: new Date(), repos: inboxRepos });
const recOf = (ctx: Ctx, c: ConversationRow) => ({ type: "conversation" as const, id: c.id, workspaceId: ctx.active.ws.id, ownerId: c.assigneeId, assigneeId: c.assigneeId });
const invalid = (e: { issues: { path: PropertyKey[]; message: string }[] }, msg: string): LibResult<never> =>
  failResult("invalid", msg, { issues: e.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) });

/** Wraps a real-mode body: AuthzError -> denied, DbError -> code; a conflict carries only the current version, never the row. */
async function real<T>(ctx: Ctx, fn: () => Promise<LibResult<T>>): Promise<LibResult<T>> {
  const t = it(vocabFor(ctx.active.tenant));
  const r = await runAction(fn);
  if (r.ok) return r;
  if (r.code === "denied") return { ...r, message: t("deniedTitle"), sub: ctx.support ? t("deniedSupport") : undefined };
  if (r.code === "conflict") {
    const v = (r.current as { version?: number } | undefined)?.version;
    return { ...r, message: t("conflictTitle"), sub: t("conflictBody"), current: v === undefined ? undefined : { version: v } };
  }
  if (r.code === "not_found") return { ...r, message: t("notFound") };
  if (r.code === "invalid" && !r.issues?.length) return { ...r, message: t("invalidTitle") };
  if (r.code === "error") return { ...r, message: t("errorTitle"), sub: t("errorBody") };
  return r;
}

/** Real mode: load the conversation and enforce the permission on THAT record (own scope = assignee). */
async function realConv(ctx: Ctx, perm: string, convId: string): Promise<ConversationRow> {
  const row = await inboxRepos.conv.get(ctx.active.ws.uuid, convId);
  if (!row) throw new DbError("not_found", "not_found");
  await assertCan(perm, recOf(ctx, row));
  return row;
}

async function load(convId: string) {
  const c = await pageCtx();
  const [convs, leads] = await Promise.all([c.ds.conversations(), c.ds.leads()]);
  const conv = c.scope.conversations(convs, leads).find((x) => x.id === convId);
  const lead = conv ? leads.find((l) => l.id === conv.leadId) : undefined;
  return { ...c, conv, lead };
}

export type SendInput = {
  convId: string; kind: "reply" | "template" | "note"; body: string; templateId?: string; vars?: string[];
  fromDraft?: boolean; edited?: boolean; lang?: "en" | "ta"; reviewed?: boolean;
};
export type SendResult = LibResult<{ messageId?: string; status?: string; live?: boolean }>;

export async function sendMessage(input: SendInput): Promise<SendResult> {
  const ctx = await pageCtx();
  if (!ctx.session.demo) {
    const t = it(vocabFor(ctx.active.tenant));
    return real(ctx, async () => {
      const p = sendSchema.safeParse(input);
      if (!p.success) return invalid(p.error, input.body.length > 4000 ? t("tooLong") : t("invalidTitle"));
      const conv = await realConv(ctx, "inbox.reply", p.data.convId);
      if (p.data.kind === "note") return P.addNote(pctx(ctx), conv, p.data.body, t);
      return P.send(pctx(ctx), conv, { kind: p.data.kind, body: p.data.body, templateId: p.data.templateId, vars: p.data.vars }, t);
    });
  }

  // ---- demo: legacy showcase behaviour, nothing stored ----
  const { conv, lead, role, support, session, now, active } = await load(input.convId);
  if (!conv || !lead) return { ok: false, code: "not_found", message: "Conversation not found in your inbox.", sub: "Nothing was sent." };
  const pc = { role, support, uid: session.uid, ownerId: lead.ownerId };
  if (!allowed("replyInbox", pc)) return { ok: false, code: "denied", message: deniedReason("replyInbox", pc), sub: "Checked on the server; nothing was sent." };
  const body = input.body.trim();
  if (!body) return { ok: false, code: "invalid", message: "Write a message or pick a template first." };
  if (input.kind === "note") return { ok: true, message: "Internal note added", sub: "Visible to your team only. Demo: not saved." };

  if (conv.channel === "whatsapp") {
    const lastIn = [...conv.messages].reverse().find((m) => m.from === "lead");
    const hours = lastIn ? (new Date(now).getTime() - new Date(lastIn.at).getTime()) / 3600e3 : Infinity;
    if (!lead.consent.whatsapp) return { ok: false, code: "invalid", message: "No WhatsApp consent on file for this contact.", sub: "Record consent before messaging on WhatsApp." };
    if (input.kind === "reply" && hours > WINDOW_H) return { ok: false, code: "invalid", message: "The 24-hour WhatsApp window has closed.", sub: "Only approved templates can be sent now (Meta rule)." };
  }
  if (input.fromDraft && conv.aiDraft.needsReview && !input.edited && role !== "owner" && !input.reviewed)
    return { ok: false, code: "invalid", message: "This draft makes a contractual commitment.", sub: vocabFor(active.tenant).ib.needsReview };

  const what = input.kind === "template" ? `Template ${input.templateId}` : input.fromDraft ? `Reviewed draft${input.edited ? " (edited)" : ""}` : "Reply";
  return {
    ok: true, data: { status: "simulated" },
    message: `${what} queued to ${lead.name.split(" ")[0]} on ${conv.channel === "whatsapp" ? "WhatsApp" : conv.channel === "email" ? "email" : "LinkedIn"}`,
    sub: `Showcase: status 'simulated', nothing was sent.${input.fromDraft ? " Logged as draft accepted by you." : ""}`,
  };
}

export async function linkConversation(convId: string, leadId: string, expectedVersion?: number): Promise<LibResult<{ version: number }>> {
  const ctx = await pageCtx();
  const t = it(vocabFor(ctx.active.tenant));
  if (!ctx.session.demo) {
    return real(ctx, async () => {
      const p = linkSchema.safeParse({ convId, leadId, expectedVersion });
      if (!p.success) return invalid(p.error, t("invalidTitle"));
      const conv = await realConv(ctx, "inbox.reply", p.data.convId);
      const target = (await ctx.ds.leads()).find((l) => l.id === p.data.leadId);
      if (!target) return failResult("not_found", t("linkTargetMissing"));
      await assertCan("leads.read", { type: "lead", id: target.id, workspaceId: ctx.active.ws.id, ownerId: target.ownerId });
      return P.link(pctx(ctx), conv, target.id, p.data.expectedVersion, target.name, t);
    });
  }
  const { conv, lead, role, support, session, ds, active } = await load(convId);
  if (!conv || !lead) return { ok: false, code: "not_found", message: "Conversation not found in your inbox." };
  const target = await ds.lead(leadId);
  const ctx2 = { role, support, uid: session.uid, ownerId: target?.ownerId };
  if (!target) return { ok: false, code: "not_found", message: vocabFor(active.tenant).ib.linkedMsg };
  if (!allowed("linkConversation", ctx2)) return { ok: false, code: "denied", message: deniedReason("linkConversation", ctx2) };
  return { ok: true, message: `Conversation linked to ${target.name}`, sub: "Demo: link not saved. Future messages from this number join that lead's timeline." };
}

export async function assignConversation(convId: string, uid: string, expectedVersion?: number): Promise<LibResult<{ version: number }>> {
  const ctx = await pageCtx();
  const t = it(vocabFor(ctx.active.tenant));
  const who = (await ctx.ds.team()).find((m) => m.id === uid);
  if (!ctx.session.demo) {
    return real(ctx, async () => {
      const p = assignSchema.safeParse({ convId, assigneeId: uid, expectedVersion });
      if (!p.success) return invalid(p.error, t("assignPick"));
      const conv = await realConv(ctx, "inbox.assign", p.data.convId);
      if (!who) return failResult("invalid", t("assignNotMember"));
      return P.assign(pctx(ctx), conv, who.id, p.data.expectedVersion, who.name, t);
    });
  }
  const { conv, role, support } = await load(convId);
  if (!conv) return { ok: false, code: "not_found", message: "Conversation not found in your inbox." };
  if (!allowed("assignConversation", { role, support })) return { ok: false, code: "denied", message: deniedReason("assignConversation", { role, support }) };
  return { ok: true, message: `Assigned to ${who?.name ?? "teammate"}`, sub: "Demo: not saved." };
}

export async function setConversationStatus(convId: string, status: "open" | "snoozed" | "closed", expectedVersion?: number): Promise<LibResult<{ version: number }>> {
  const ctx = await pageCtx();
  const t = it(vocabFor(ctx.active.tenant));
  if (!ctx.session.demo) {
    const res = await real(ctx, async () => {
      const p = statusSchema.safeParse({ convId, status, expectedVersion });
      if (!p.success) return invalid(p.error, t("invalidTitle"));
      const conv = await realConv(ctx, "inbox.reply", p.data.convId);
      return P.setStatus(pctx(ctx), conv, p.data.status, p.data.expectedVersion, t);
    });
    // Snooze needs conversations.status to accept 'snoozed' (schema change for the next DB task); until then say so plainly.
    if (!res.ok && status === "snoozed" && res.code === "invalid") return failResult("invalid", t("snoozeUnavailable"), { sub: t("snoozeUnavailableSub") });
    return res;
  }
  const { conv, lead, role, support, session } = await load(convId);
  if (!conv || !lead) return { ok: false, code: "not_found", message: "Conversation not found in your inbox." };
  const pc = { role, support, uid: session.uid, ownerId: lead.ownerId };
  if (!allowed("replyInbox", pc)) return { ok: false, code: "denied", message: deniedReason("replyInbox", pc) };
  return okResult(status === "closed" ? "Conversation closed" : status === "snoozed" ? "Conversation snoozed" : "Conversation reopened",
    { sub: "Reopens automatically on the next inbound message. Demo: not saved." });
}

export async function closeConversation(convId: string, expectedVersion?: number) {
  return setConversationStatus(convId, "closed", expectedVersion);
}

/** Stamps last_read_at. Quiet by design: the UI does not toast on success. */
export async function markConversationRead(convId: string, expectedVersion?: number): Promise<LibResult<{ version: number }>> {
  const ctx = await pageCtx();
  const t = it(vocabFor(ctx.active.tenant));
  if (ctx.session.demo) return okResult(t("demoNotice"));
  return real(ctx, async () => {
    const p = readSchema.safeParse({ convId, expectedVersion });
    if (!p.success) return invalid(p.error, t("invalidTitle"));
    const conv = await realConv(ctx, "inbox.read", p.data.convId);
    return P.markRead(pctx(ctx), conv, p.data.expectedVersion, t);
  });
}

