// Real-mode persistence for inbox actions. Pure over injected repositories so it is unit-testable with the mocked client.
// assertCan (record-level) runs in actions.ts BEFORE any of these. Audit rows and conversation.* / message.* events come
// from DB triggers (migration 0014), so success is only returned after the commit.
import { failResult, okResult, type ActionResult } from "@/lib/actions/result";
import type { ConversationRow, MessageInput, MessageRow } from "@/lib/db/repo/types";
import { channelFor } from "./channel";
import { fillTemplate } from "./fill";
import { purposeFor, windowState } from "./window";

export interface TemplateRow { id: string; channel: string; name: string; body: string; status?: string | null; approvalStatus?: string | null }
export interface Repos {
  conv: {
    update(ws: string, id: string, v: number, patch: Record<string, unknown>): Promise<ConversationRow>;
    /** unversioned bookkeeping write (last_message_at); never fails a send on a version race */
    touch(ws: string, id: string, patch: Record<string, unknown>): Promise<void>;
    get(ws: string, id: string): Promise<ConversationRow | null>;
  };
  msgs: { create(ws: string, input: MessageInput): Promise<MessageRow> };
  templates: { get(ws: string, id: string): Promise<TemplateRow | null> };
  consent: { canContact(leadId: string, purpose: string): Promise<boolean> };
  leads: { get(ws: string, id: string): Promise<{ id: string } | null> };
}
export interface Ctx { ws: string; uid: string; now: Date; repos: Repos }
export type T = (key: string, vars?: Record<string, string | number>) => string;

const CH_NAME: Record<string, string> = { whatsapp: "WhatsApp", email: "email", linkedin: "LinkedIn" };
const issue = (path: string, message: string) => [{ path, message }];

export const templateApproved = (t: TemplateRow) => (t.status ?? t.approvalStatus) === "approved";
export { fillTemplate };

export interface SendIn { kind: "reply" | "template"; body: string; templateId?: string; vars: string[] }
export interface SendOut { messageId: string; status: "queued"; live: boolean }

/** Reply or template: lead present -> window (free text, WhatsApp) -> template approved -> consent -> insert queued. */
export async function send(c: Ctx, conv: ConversationRow, i: SendIn, t: T): Promise<ActionResult<SendOut>> {
  if (!conv.leadId) return failResult("invalid", t("noLead"), { sub: t("noLeadSub"), issues: issue("lead", t("noLead")) });
  let text = i.body.trim();
  let templateId: string | null = null;

  if (i.kind === "template") {
    if (!i.templateId) return failResult("invalid", t("templateNeeded"), { issues: issue("template", t("templateNeeded")) });
    const tpl = await c.repos.templates.get(c.ws, i.templateId);
    if (!tpl || tpl.channel !== conv.channel || !templateApproved(tpl)) return failResult("invalid", t("templateNotApproved"), { issues: issue("template", t("templateNotApproved")) });
    text = fillTemplate(tpl.body, i.vars).trim(); // the body always comes from the stored template, never from the client
    templateId = tpl.id;
  } else {
    if (!text) return failResult("invalid", t("emptyBody"), { issues: issue("body", t("emptyBody")) });
    const w = windowState(conv.channel, conv.lastInboundAt, c.now);
    if (!w.open) return failResult("invalid", t("windowClosed"), { sub: t("windowClosedSub"), issues: issue("window", t("windowClosed")) });
  }

  const allowed = await c.repos.consent.canContact(conv.leadId, purposeFor(conv.channel));
  if (!allowed) return failResult("invalid", t("noConsent", { channel: CH_NAME[conv.channel] ?? conv.channel }), { sub: t("noConsentSub"), issues: issue("consent", t("noConsentSub")) });

  const msg = await c.repos.msgs.create(c.ws, {
    conversationId: conv.id, direction: "outbound", status: "queued", body: text, templateId, isInternalNote: false, sentBy: c.uid,
  } as MessageInput);
  await c.repos.conv.touch(c.ws, conv.id, { lastMessageAt: c.now.toISOString() });
  const live = channelFor(conv.channel).live;
  return okResult(live ? t("queuedLive") : t("queued"), { sub: t("queuedSub"), data: { messageId: msg.id, status: "queued", live } });
}

/** Internal note: stored as an outbound row flagged is_internal_note. Status 'simulated' (never 'queued') so no dispatcher can ever pick it up. */
export async function addNote(c: Ctx, conv: ConversationRow, body: string, t: T): Promise<ActionResult<{ messageId: string }>> {
  const text = body.trim();
  if (!text) return failResult("invalid", t("emptyBody"), { issues: issue("body", t("emptyBody")) });
  const msg = await c.repos.msgs.create(c.ws, {
    conversationId: conv.id, direction: "outbound", status: "simulated", body: text, templateId: null, isInternalNote: true, sentBy: c.uid,
  } as MessageInput);
  return okResult(t("noteAdded"), { sub: t("noteSub"), data: { messageId: msg.id } });
}

export async function setStatus(c: Ctx, conv: ConversationRow, status: "open" | "snoozed" | "closed", v: number, t: T): Promise<ActionResult<{ version: number }>> {
  const row = await c.repos.conv.update(c.ws, conv.id, v, { status });
  return okResult(status === "closed" ? t("closed") : status === "snoozed" ? t("snoozed") : t("reopened"), { data: { version: row.version } });
}

export async function assign(c: Ctx, conv: ConversationRow, assigneeId: string, v: number, name: string, t: T): Promise<ActionResult<{ version: number }>> {
  const row = await c.repos.conv.update(c.ws, conv.id, v, { assigneeId });
  return okResult(t("assigned", { name }), { data: { version: row.version } });
}

export async function link(c: Ctx, conv: ConversationRow, leadId: string, v: number, name: string, t: T): Promise<ActionResult<{ version: number }>> {
  if (!(await c.repos.leads.get(c.ws, leadId))) return failResult("not_found", t("linkTargetMissing"));
  const row = await c.repos.conv.update(c.ws, conv.id, v, { leadId });
  return okResult(t("linked", { name }), { sub: t("linkedSub"), data: { version: row.version } });
}

/** Mark read stamps last_read_at. A read marker must not raise a conflict banner, so one stale version is retried once on the fresh row. */
export async function markRead(c: Ctx, conv: ConversationRow, v: number | undefined, t: T): Promise<ActionResult<{ version: number }>> {
  const patch = { lastReadAt: c.now.toISOString() };
  try {
    const row = await c.repos.conv.update(c.ws, conv.id, v ?? conv.version, patch);
    return okResult(t("markReadBtn"), { data: { version: row.version } });
  } catch (e) {
    if ((e as { code?: string }).code !== "conflict") throw e;
    const fresh = await c.repos.conv.get(c.ws, conv.id);
    if (!fresh) throw e;
    const row = await c.repos.conv.update(c.ws, conv.id, fresh.version, patch);
    return okResult(t("markReadBtn"), { data: { version: row.version } });
  }
}
