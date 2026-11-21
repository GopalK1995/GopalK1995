// Booked / cancelled booking -> calendar row + task + owner notification, matched to a lead by email (shared by Calendly and Cal.com).
//  * Match: lower-cased email inside the connection's own workspace only. An unknown email creates NOTHING but an unmatched-booking
//    record (a calendar row with no linked object, a `booking.unmatched` event and a notification to the workspace owners). No lead, contact or task.
//  * Idempotent: the calendar row is unique per (connection, vendor booking id) and forward-only; tasks dedupe on (lead, title); notifications
//    dedupe on a key. A replayed delivery re-runs the side effects and every one of them is a no-op.
//  * Reschedule: the old half arrives as a silent cancellation (no task, no notice); the new half is a normal booking.
//  * PII: events carry ids and times only. The invitee name appears only in the owner's notification text; the email is never stored here.
import type { ConnectionRow } from "../core/types";
import type { BookingEvent } from "./booking-types";
import { CANCEL_FOLLOW_UP_MS, DEFAULT_DISPLAY_TZ, PREP_LEAD_MS } from "./constants";
import type { BookingDeps } from "./store";
import { fill, t as tr } from "./strings";

export interface HandleInput { deps: BookingDeps; conn: ConnectionRow; reject?: (reason: string) => void }

type Loc = "en" | "ta";
const LOCALES: Loc[] = ["en", "ta"];
const zoneOf = (conn: ConnectionRow): string => {
  const z = conn.settings.display_timezone;
  if (typeof z === "string") { try { new Intl.DateTimeFormat("en", { timeZone: z }); return z; } catch { /* fall back to the default */ } }
  return DEFAULT_DISPLAY_TZ;
};
export function whenText(iso: string | null, zone: string, locale: Loc): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale === "ta" ? "ta-IN" : "en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: zone }).format(new Date(iso));
}

/** Due time: a booking is prepped an hour before it starts (never in the past); a cancellation is chased the next day. */
export const dueFor = (kind: "booked" | "cancelled", startsAt: string | null, now: Date): string =>
  new Date(kind === "booked" && startsAt ? Math.max(now.getTime(), Date.parse(startsAt) - PREP_LEAD_MS) : now.getTime() + CANCEL_FOLLOW_UP_MS).toISOString();

/** Tail of the vendor id, so two bookings by one lead at the same time still get distinct task titles. */
const shortRef = (id: string): string => id.replace(/[^A-Za-z0-9]/g, "").slice(-6);

export async function handleBooking({ deps, conn, reject }: HandleInput, evt: BookingEvent): Promise<void> {
  if (evt.kind === "ignored") return;
  const { store, log, now } = deps;
  const cancelled = evt.kind === "cancelled";
  const silentHalf = cancelled && evt.rescheduled;
  if (!evt.externalId) { reject?.("missing_booking_id"); return; }
  const timesOk = !!evt.startsAt && !!evt.endsAt && Date.parse(evt.endsAt) >= Date.parse(evt.startsAt);
  if (!timesOk && !silentHalf) { reject?.("bad_time"); return; }   // the old half of a reschedule only needs its id

  const lead = evt.email ? await store.findLeadByEmail(conn.workspaceId, evt.email) : null;
  const startsAt = evt.startsAt ?? now().toISOString();
  const res = await store.upsertCalendarEvent({
    tenantId: conn.tenantId, workspaceId: conn.workspaceId, integrationId: conn.id, externalId: evt.externalId,
    startsAt, endsAt: evt.endsAt ?? startsAt, title: evt.title, leadId: lead?.id ?? null, status: cancelled ? "cancelled" : "confirmed",
    onlyIfExists: silentHalf,
  });
  if (silentHalf || res.outcome === "stale" || res.outcome === "missing") return;   // silent half of a reschedule, or an out-of-order delivery

  const leadId = res.leadId ?? lead?.id ?? null;
  const zone = zoneOf(conn);
  const vars = (l: Loc) => ({ name: evt.name ?? tr(l, "someone"), event: evt.title, when: whenText(evt.startsAt, zone, l) });
  const mk = (key: string): Record<string, string> => Object.fromEntries(LOCALES.map((l) => [l, fill(tr(l, key), vars(l))]));
  const dedupe = `${conn.id}:${evt.externalId}:${evt.kind}`;

  if (!leadId) {
    const n = await store.notifyOnce({
      tenantId: conn.tenantId, workspaceId: conn.workspaceId, userIds: await store.workspaceOwners(conn.workspaceId), kind: "booking.unmatched",
      objectType: null, objectId: null, title: mk(cancelled ? "notice_cancelledUnmatched_title" : "notice_unmatched_title"),
      body: mk(cancelled ? "notice_cancelledUnmatched_body" : "notice_unmatched_body"), url: "/calendar", dedupe,
    });
    if (n > 0 && res.id) await store.emit({ type: "booking.unmatched", workspaceId: conn.workspaceId, objectType: "calendar_event", objectId: res.id, data: { vendor: evt.vendor, status: cancelled ? "cancelled" : "confirmed", starts_at: evt.startsAt } });
    log.info("booking unmatched", { connection: conn.id, vendor: evt.vendor, kind: evt.kind });
    return;
  }

  await store.insertTaskOnce({
    tenantId: conn.tenantId, workspaceId: conn.workspaceId, leadId, assigneeId: lead?.ownerId ?? null,
    title: `${fill(tr("en", cancelled ? "task_cancelled" : "task_booked"), vars("en"))} [${shortRef(evt.externalId)}]`,
    kind: cancelled ? "follow_up" : "demo_prep", priority: cancelled ? 2 : 1, dueAt: dueFor(evt.kind, evt.startsAt, now()),
  });
  const n = await store.notifyOnce({
    tenantId: conn.tenantId, workspaceId: conn.workspaceId, userIds: lead?.ownerId ? [lead.ownerId] : await store.workspaceOwners(conn.workspaceId),
    kind: cancelled ? "booking.cancelled" : "booking.created", objectType: "lead", objectId: leadId,
    title: mk(cancelled ? "notice_cancelled_title" : "notice_booked_title"), body: mk(cancelled ? "notice_cancelled_body" : "notice_booked_body"),
    url: `/leads/${leadId}`, dedupe,
  });
  if (n > 0) await store.emit({ type: cancelled ? "booking.cancelled" : "booking.created", workspaceId: conn.workspaceId, objectType: "lead", objectId: leadId, data: { vendor: evt.vendor, calendar_event_id: res.id, starts_at: evt.startsAt, rescheduled: evt.rescheduled } });
  log.info("booking applied", { connection: conn.id, vendor: evt.vendor, kind: evt.kind, outcome: res.outcome });
}
