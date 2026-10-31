// notify.event processing (CONTRACTS C8.2): one (event, rule) pair -> in-app notifications + queued email intents.
// Pure over a port, so it is unit-tested with fakes. Idempotent: every notification carries a dedupe key
// "<payload.dedupe>:<user id>" stored in body.dedupe; a redelivered message creates nothing twice.
import { evaluateConditions } from "@/lib/authz/conditions";
import type { EventRow } from "@/lib/events/types";
import { getEmailSender, type EmailSender } from "./email";
import { decideDelivery } from "./prefs";
import { objectUrl } from "./urls";
import { NOTE_BODY_MAX, type PrefRow, type RuleRow } from "./types";

export interface NotifyPayload { event_id: string | number; occurred_at: string; rule_id: string; workspace_id: string; type: string; dedupe: string }

export interface NotificationInsert {
  workspaceId: string; userId: string; kind: string; objectType: string | null; objectId: string | null; actorId: string | null;
  title: Record<string, string>; body: Record<string, string>; url: string | null;
}

export interface NotifyPorts {
  event(id: string, occurredAt: string): Promise<EventRow | null>;
  rule(id: string, ws: string): Promise<RuleRow | null>;
  objectOwners(type: string, id: string, ws: string): Promise<{ ownerId: string | null; assigneeId: string | null } | null>;
  teamManagers(userIds: string[], ws: string): Promise<string[]>;
  roleMembers(roleId: string, ws: string): Promise<string[]>;
  followers(type: string, id: string): Promise<string[]>;
  /** Subset of `ids` with an active membership in the workspace. */
  activeMembers(ids: string[], ws: string): Promise<string[]>;
  /** authz.user_can_read for another user. Never true across workspaces. */
  canRead(userId: string, ws: string, type: string, id: string): Promise<boolean>;
  displayName(userId: string): Promise<string | null>;
  prefs(userIds: string[], ws: string): Promise<PrefRow[]>;
  /** Which of these dedupe keys already have a notification. */
  existing(userIds: string[], ws: string, keys: string[]): Promise<Set<string>>;
  insert(rows: NotificationInsert[]): Promise<void>;
  emailOf(userId: string): Promise<string | null>;
}

/** The comments trigger (0018) already writes in-app rows for these; rules only add email intents. */
export const DB_NOTIFIED = new Set(["comment.created", "mention.created"]);
export const MAX_RECIPIENTS = 200;
const UUID = /^[0-9a-f-]{36}$/i;

const humanise = (t: string) => { const s = t.replace(/[._]/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m).slice(0, NOTE_BODY_MAX);

export async function resolveRecipients(rule: RuleRow, ev: EventRow, ports: NotifyPorts): Promise<string[]> {
  const out = new Set<string>();
  const owners = ev.object_type && ev.object_id ? await ports.objectOwners(ev.object_type, ev.object_id, ev.workspace_id) : null;
  for (const token of rule.recipients) {
    if (token === "owner") {
      for (const u of [owners?.ownerId, owners?.assigneeId]) if (u) out.add(u);
    } else if (token === "team_manager") {
      const base = [owners?.ownerId, owners?.assigneeId].filter((u): u is string => !!u);
      if (base.length) for (const u of await ports.teamManagers(base, ev.workspace_id)) out.add(u);
    } else if (token === "followers") {
      if (ev.object_type && ev.object_id) for (const u of await ports.followers(ev.object_type, ev.object_id)) out.add(u);
    } else if (token.startsWith("role:") && UUID.test(token.slice(5))) {
      for (const u of await ports.roleMembers(token.slice(5), ev.workspace_id)) out.add(u);
    } else if (token.startsWith("user:") && UUID.test(token.slice(5))) {
      out.add(token.slice(5));
    }
  }
  return [...out];
}

export async function processNotify(
  payload: NotifyPayload, ports: NotifyPorts,
  opts: { now?: Date; sender?: EmailSender; log?: (m: string, f?: Record<string, unknown>) => void } = {},
): Promise<"done" | "retry"> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const ev = await ports.event(String(payload.event_id), payload.occurred_at);
  if (!ev || ev.workspace_id !== payload.workspace_id) { log("notify: event missing or foreign workspace"); return "done"; }
  const rule = await ports.rule(payload.rule_id, payload.workspace_id);
  if (!rule || !rule.enabled || rule.workspaceId !== payload.workspace_id) return "done";
  const record = (ev.data && typeof ev.data === "object" ? ((ev.data as Record<string, unknown>).after ?? ev.data) : {}) as Record<string, unknown>;
  if (!evaluateConditions(rule.conditions, { record, principal: {}, now })) return "done";

  const actorId = ev.actor_kind === "user" ? ev.actor_id : null;
  let ids = (await resolveRecipients(rule, ev, ports)).filter((u) => u !== actorId);
  ids = await ports.activeMembers([...new Set(ids)], ev.workspace_id);
  if (ev.object_type && ev.object_id) {
    // Notifications respect read access: someone who cannot open the record never learns it changed.
    const kept: string[] = [];
    for (const u of ids) if (await ports.canRead(u, ev.workspace_id, ev.object_type, ev.object_id)) kept.push(u);
    ids = kept;
  }
  ids = ids.slice(0, MAX_RECIPIENTS);
  if (!ids.length) return "done";

  const keyOf = (u: string) => `${payload.dedupe}:${u}`;
  const have = await ports.existing(ids, ev.workspace_id, ids.map(keyOf));
  const prefs = await ports.prefs(ids, ev.workspace_id);
  const actorName = actorId ? await ports.displayName(actorId) : null;
  const vars = { actor: actorName ?? "Someone", event: humanise(ev.type) };
  const title = rule.template.title && Object.keys(rule.template.title).length
    ? Object.fromEntries(Object.entries(rule.template.title).map(([l, s]) => [l, fill(s, vars)]))
    : { en: fill("{event}", vars) };
  const bodyText = rule.template.body && Object.keys(rule.template.body).length
    ? Object.fromEntries(Object.entries(rule.template.body).map(([l, s]) => [l, fill(s, vars)]))
    : { en: actorName ? fill("By {actor}", vars) : "" };
  const url = objectUrl(ev.object_type, ev.object_id);

  const inserts: NotificationInsert[] = [];
  const emails: { userId: string; dedupe: string; deliverAfter?: string }[] = [];
  for (const u of ids) {
    if (have.has(keyOf(u))) continue; // redelivery: already handled for this user
    const d = decideDelivery({ ruleChannels: rule.channels, prefs: prefs.filter((p) => p.userId === u), eventType: ev.type, now });
    if (d.muted) continue;
    const inApp = d.inApp && !DB_NOTIFIED.has(ev.type);
    if (!inApp && d.email === "none") continue;
    // Email-only intents (DB-notified kinds) carry no row; the sender's own `dedupe` key makes them idempotent.
    if (inApp) inserts.push({
      workspaceId: ev.workspace_id, userId: u, kind: ev.type, objectType: ev.object_type, objectId: ev.object_id, actorId,
      title, url,
      body: { ...bodyText, dedupe: keyOf(u), ...(d.email === "queued" ? { email: "queued", ...(d.deliverAfter ? { deliverAfter: d.deliverAfter } : {}) } : {}) },
    });
    if (d.email === "queued") emails.push({ userId: u, dedupe: keyOf(u), deliverAfter: d.deliverAfter });
  }
  if (inserts.length) await ports.insert(inserts);

  const sender = opts.sender ?? getEmailSender();
  for (const e of emails) {
    const to = await ports.emailOf(e.userId);
    if (!to) continue;
    // The stub reports "queued". Anything else is logged, never written back as delivered here (T038 owns delivery state).
    const r = await sender.send({ to, subject: title.en ?? vars.event, text: bodyText.en ?? "", deliverAfter: e.deliverAfter, dedupe: e.dedupe });
    if (r.status !== "queued") log("notify: email sender result", { status: r.status });
  }
  return "done";
}
