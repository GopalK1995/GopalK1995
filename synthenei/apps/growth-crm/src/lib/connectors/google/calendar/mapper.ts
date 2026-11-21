// Pure two-way mapping between Google events and calendar_events rows. No I/O, no clock: unit-tested against fixtures.
// Privacy rule: an inbound event is kept only when it is CRM-related (stamped by the CRM, or an attendee is a known contact/lead).
// Everything else on a user's calendar is ignored (never stored), and private/confidential events are always ignored.
import { MAX_TITLE, PROP, EVENT_KINDS, type EventKind } from "./constants";
import type { CalRow, CalStatus, GEvent, GTime, LocalEvent, ObjectRef } from "./types";

export type MapResult =
  | { ok: true; kind: "upsert"; row: CalRow }
  | { ok: true; kind: "cancel"; externalId: string }
  | { ok: false; reason: "private_event" | "not_crm_related" | "no_time" | "bad_time" | "no_id" };

export interface MapCtx {
  /** Prefix that makes the external id unique per connected user (events can be shared between several calendars). */
  userKey: string;
  calendarTz?: string;
  /** lower-case email -> CRM record, from the store (workspace-scoped). */
  contacts: Map<string, ObjectRef>;
}

/** Midnight of a calendar date in a time zone, as an ISO instant. Falls back to UTC for a missing or invalid zone. */
export function zonedMidnightIso(date: string, tz?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return "";
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (!tz) return new Date(utc).toISOString();
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utc)).map((p) => [p.type, p.value]));
    const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return new Date(utc - (local - utc)).toISOString();
  } catch { return new Date(utc).toISOString(); }
}

function instant(t: GTime | undefined, calendarTz?: string): string | null {
  if (!t) return null;
  if (t.dateTime) { const ms = Date.parse(t.dateTime); return Number.isNaN(ms) ? "" : new Date(ms).toISOString(); }
  if (t.date) return zonedMidnightIso(t.date, t.timeZone ?? calendarTz);
  return null;
}

const statusOf = (s: string | undefined): CalStatus => (s === "cancelled" ? "cancelled" : s === "tentative" ? "tentative" : "confirmed");
const kindOf = (v: string | undefined): EventKind | null => ((EVENT_KINDS as readonly string[]).includes(v ?? "") ? (v as EventKind) : null);
const OBJECT_ID = /^[0-9a-zA-Z_-]{1,64}$/;
const OBJECT_TYPE = /^(lead|contact|account|deal|obj:[a-z0-9_]{1,40})$/;

export function mapEvent(ev: GEvent, ctx: MapCtx): MapResult {
  if (!ev.id) return { ok: false, reason: "no_id" };
  const externalId = `${ctx.userKey}:${ev.id}`;
  if (ev.status === "cancelled") return { ok: true, kind: "cancel", externalId };
  if (ev.visibility === "private" || ev.visibility === "confidential") return { ok: false, reason: "private_event" };
  const props = ev.extendedProperties?.private ?? {};
  let objectType: string | null = OBJECT_TYPE.test(props[PROP.objectType] ?? "") ? props[PROP.objectType] : null;
  let objectId: string | null = objectType && OBJECT_ID.test(props[PROP.objectId] ?? "") ? props[PROP.objectId] : null;
  if (!objectId) objectType = null;
  const kind = kindOf(props[PROP.kind]);
  if (!kind && !objectId) {
    const emails = (ev.attendees ?? []).filter((a) => !a.self && !a.resource && a.email).map((a) => a.email!.toLowerCase()).sort();
    const hit = emails.map((e) => ctx.contacts.get(e)).find(Boolean);
    if (!hit) return { ok: false, reason: "not_crm_related" };
    objectType = hit.type; objectId = hit.id;
  }
  const s = instant(ev.start, ctx.calendarTz), e = instant(ev.end, ctx.calendarTz);
  if (s === null || e === null) return { ok: false, reason: "no_time" };
  if (s === "" || e === "" || e < s) return { ok: false, reason: "bad_time" };
  return { ok: true, kind: "upsert", row: { externalId, startsAt: s, endsAt: e, title: (ev.summary ?? "").trim().slice(0, MAX_TITLE), status: statusOf(ev.status), objectType, objectId, kind, remoteUpdated: ev.updated ?? null } };
}

/** Content signature: equal on both sides means there is nothing to sync (stops pull/push echo). */
export const sigOf = (r: { title: string; startsAt: string; endsAt: string; status: string }): string => [r.title, new Date(r.startsAt).toISOString(), new Date(r.endsAt).toISOString(), r.status].join("|");

/** The kind a local row is pushed as: a tentative row linked to a custom object is a hold (room, table...); otherwise a meeting. */
export const kindForLocal = (l: Pick<LocalEvent, "status" | "objectType">): EventKind => (l.status === "tentative" && (l.objectType ?? "").startsWith("obj:") ? "room_hold" : "meeting");

export function toGoogleEvent(l: Pick<LocalEvent, "title" | "startsAt" | "endsAt" | "status" | "objectType" | "objectId">, kind: EventKind): Record<string, unknown> {
  const priv: Record<string, string> = { [PROP.kind]: kind };
  if (l.objectType && l.objectId) { priv[PROP.objectType] = l.objectType; priv[PROP.objectId] = l.objectId; }
  return {
    summary: l.title, start: { dateTime: new Date(l.startsAt).toISOString() }, end: { dateTime: new Date(l.endsAt).toISOString() },
    status: l.status, transparency: "opaque", guestsCanModify: false, extendedProperties: { private: priv },
  };
}

/** Last write wins. "apply" means Google's copy overwrites the local row. */
export function decideInbound(local: { updatedAt: string; sig: string } | undefined, remote: Pick<CalRow, "remoteUpdated" | "title" | "startsAt" | "endsAt" | "status">): "apply" | "same" | "keep_local" {
  if (!local) return "apply";
  if (local.sig === sigOf(remote)) return "same";
  const r = remote.remoteUpdated ? Date.parse(remote.remoteUpdated) : NaN;
  return !Number.isNaN(r) && Date.parse(local.updatedAt) > r ? "keep_local" : "apply";
}
