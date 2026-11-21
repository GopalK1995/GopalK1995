// Pure mappers from Microsoft Graph shapes (message, event, change notification) to the CRM's rows. No network, no store.
// A row that cannot be read is REJECTED with a reason (counted, never invented). Mail keeps the subject and Graph's 255-character
// preview only, never the full body or attachments.
import { GRAPH_ID, MAX_TITLE } from "./constants";

export interface RawAddress { emailAddress?: { name?: string; address?: string } }
export interface RawMessage {
  id?: string; subject?: string | null; bodyPreview?: string | null; from?: RawAddress; toRecipients?: RawAddress[]; ccRecipients?: RawAddress[];
  receivedDateTime?: string; sentDateTime?: string; conversationId?: string; internetMessageId?: string; isDraft?: boolean; "@removed"?: { reason?: string };
}
export interface RawDateTime { dateTime?: string; timeZone?: string }
export interface RawEvent {
  id?: string; subject?: string | null; start?: RawDateTime; end?: RawDateTime; isCancelled?: boolean; isAllDay?: boolean; showAs?: string;
  responseStatus?: { response?: string }; attendees?: { emailAddress?: { address?: string } }[]; "@removed"?: { reason?: string };
}

export interface MailRow {
  externalId: string; threadId: string; subject: string; preview: string; from: string | null; to: string[]; cc: string[]; at: string;
}
export interface EventRow { externalId: string; title: string; startsAt: string; endsAt: string; status: "confirmed" | "tentative" | "cancelled"; attendees: string[] }

export type MailResult = { kind: "message"; row: MailRow } | { kind: "removed"; externalId: string } | { kind: "skip"; why: "draft" } | { kind: "reject"; reason: string };
export type EventResult = { kind: "event"; row: EventRow } | { kind: "removed"; externalId: string } | { kind: "reject"; reason: string };

const EMAIL = /^[^\s@<>()",;:\\]{1,64}@[^\s@<>()",;:\\]{1,255}\.[^\s@<>()",;:\\]{2,63}$/;
/** Lower-cased address, or null for anything that is not a plain SMTP address (Exchange X500 paths, empty values). */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}
const addrs = (l: RawAddress[] | undefined): string[] => [...new Set((Array.isArray(l) ? l : []).map((a) => cleanEmail(a?.emailAddress?.address)).filter((x): x is string => !!x))];
const oneLine = (s: unknown, max: number): string => (typeof s === "string" ? s.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const isoOf = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};
export const validGraphId = (id: unknown): id is string => typeof id === "string" && GRAPH_ID.test(id);

export function normaliseMessage(m: RawMessage): MailResult {
  if (!validGraphId(m?.id)) return { kind: "reject", reason: "missing_id" };
  if (m["@removed"]) return { kind: "removed", externalId: m.id };
  if (m.isDraft) return { kind: "skip", why: "draft" };
  const at = isoOf(m.receivedDateTime) ?? isoOf(m.sentDateTime);
  if (!at) return { kind: "reject", reason: "bad_date" };
  return {
    kind: "message",
    row: {
      externalId: m.id, threadId: validGraphId(m.conversationId) ? m.conversationId : m.id, subject: oneLine(m.subject, 255), preview: oneLine(m.bodyPreview, 255),
      from: cleanEmail(m.from?.emailAddress?.address), to: addrs(m.toRecipients), cc: addrs(m.ccRecipients), at,
    },
  };
}

/** Requests always carry `Prefer: outlook.timezone="UTC"`, so a non-UTC zone means the header was ignored: rejected, never guessed. */
export function parseGraphDate(d: RawDateTime | undefined): string | null {
  if (!d || typeof d.dateTime !== "string") return null;
  const tz = (d.timeZone ?? "UTC").toUpperCase();
  if (tz !== "UTC") return null;
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z?$/.exec(d.dateTime.trim());
  return m ? isoOf(`${m[1]}${m[2] ? m[2].slice(0, 4) : ""}Z`) : null;
}

export function normaliseEvent(e: RawEvent): EventResult {
  if (!validGraphId(e?.id)) return { kind: "reject", reason: "missing_id" };
  if (e["@removed"]) return { kind: "removed", externalId: e.id };
  const s = parseGraphDate(e.start), en = parseGraphDate(e.end);
  if (!s || !en) return { kind: "reject", reason: e.start && e.end && (e.start.timeZone ?? "UTC").toUpperCase() !== "UTC" ? "unsupported_timezone" : "bad_date" };
  if (Date.parse(en) < Date.parse(s)) return { kind: "reject", reason: "end_before_start" };
  const tentative = e.showAs === "tentative" || e.responseStatus?.response === "tentativelyAccepted";
  return {
    kind: "event",
    row: {
      externalId: e.id, title: oneLine(e.subject, MAX_TITLE), startsAt: s, endsAt: en,
      status: e.isCancelled ? "cancelled" : tentative ? "tentative" : "confirmed",
      attendees: [...new Set((Array.isArray(e.attendees) ? e.attendees : []).map((a) => cleanEmail(a?.emailAddress?.address)).filter((x): x is string => !!x))],
    },
  };
}

// ---------- change notifications ----------
export interface RawNotification {
  subscriptionId?: string; clientState?: string; changeType?: string; resource?: string; lifecycleEvent?: string;
  resourceData?: { id?: string; "@odata.type"?: string }; subscriptionExpirationDateTime?: string; tenantId?: string;
}
export type GraphEvent =
  | { kind: "change"; subscriptionId: string; changeType: "created" | "updated" | "deleted"; type: "message" | "event"; id: string }
  | { kind: "lifecycle"; subscriptionId: string; event: "reauthorizationRequired" | "subscriptionRemoved" | "missed" };

const CHANGE = new Set(["created", "updated", "deleted"]);
const LIFECYCLE = new Set(["reauthorizationRequired", "subscriptionRemoved", "missed"]);
const SUB_ID = /^[A-Za-z0-9_\-]{1,128}$/;

/** Parses a notification body into events. Anything unreadable is dropped (and counted by the caller through the length difference). */
export function parseNotifications(raw: string): { events: GraphEvent[]; dropped: number } {
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { events: [], dropped: 0 }; }
  const list = j && typeof j === "object" && Array.isArray((j as { value?: unknown }).value) ? ((j as { value: RawNotification[] }).value) : [];
  const events: GraphEvent[] = [];
  let dropped = 0;
  for (const n of list.slice(0, 1000)) {
    const sub = n?.subscriptionId;
    if (typeof sub !== "string" || !SUB_ID.test(sub)) { dropped++; continue; }
    if (n.lifecycleEvent) {
      if (LIFECYCLE.has(n.lifecycleEvent)) events.push({ kind: "lifecycle", subscriptionId: sub, event: n.lifecycleEvent as "reauthorizationRequired" });
      else dropped++;
      continue;
    }
    const type = /message/i.test(n.resourceData?.["@odata.type"] ?? "") ? "message" : /event/i.test(n.resourceData?.["@odata.type"] ?? "") ? "event" : null;
    const id = n.resourceData?.id;
    if (!type || !validGraphId(id) || !n.changeType || !CHANGE.has(n.changeType)) { dropped++; continue; }
    events.push({ kind: "change", subscriptionId: sub, changeType: n.changeType as "created", type, id });
  }
  return { events, dropped };
}
