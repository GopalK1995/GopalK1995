// Calendar mapper against fixtures shaped like Calendar API v3 events (synthetic values, not captures).
import { describe, expect, it } from "vitest";
import { decideInbound, kindForLocal, mapEvent, sigOf, toGoogleEvent, zonedMidnightIso } from "../mapper";
import type { GEvent } from "../types";

const contacts = new Map([["guest@example.com", { type: "lead", id: "lead-1" }]]);
const ctx = { userKey: "u1", calendarTz: "Asia/Kolkata", contacts };

const stamped: GEvent = { id: "e1", status: "confirmed", summary: "  Product demo ", updated: "2026-11-01T10:00:00Z", start: { dateTime: "2026-11-10T10:00:00+05:30" }, end: { dateTime: "2026-11-10T11:00:00+05:30" }, extendedProperties: { private: { crm_kind: "demo", crm_object_type: "lead", crm_object_id: "lead-9" } } };

describe("mapEvent", () => {
  it("maps a CRM-stamped demo with its linked record and a per-user external id", () => {
    const r = mapEvent(stamped, ctx);
    expect(r).toMatchObject({ ok: true, kind: "upsert", row: { externalId: "u1:e1", title: "Product demo", startsAt: "2026-11-10T04:30:00.000Z", endsAt: "2026-11-10T05:30:00.000Z", status: "confirmed", objectType: "lead", objectId: "lead-9", kind: "demo" } });
  });
  it("maps an all-day tentative room hold in the calendar's time zone (end date is exclusive)", () => {
    const hold: GEvent = { id: "h1", status: "tentative", summary: "Hold", start: { date: "2026-12-01" }, end: { date: "2026-12-03" }, extendedProperties: { private: { crm_kind: "room_hold", crm_object_type: "obj:booking", crm_object_id: "rec-1" } } };
    const r = mapEvent(hold, ctx);
    expect(r).toMatchObject({ ok: true, row: { status: "tentative", kind: "room_hold", objectType: "obj:booking", startsAt: "2026-11-30T18:30:00.000Z", endsAt: "2026-12-02T18:30:00.000Z" } });
  });
  it("links an unstamped event through a known attendee, ignoring the user's own address", () => {
    const ev: GEvent = { id: "e2", summary: "Call", start: { dateTime: "2026-11-11T09:00:00Z" }, end: { dateTime: "2026-11-11T09:30:00Z" }, attendees: [{ email: "me@example.com", self: true }, { email: "Guest@Example.com" }] };
    expect(mapEvent(ev, ctx)).toMatchObject({ ok: true, row: { objectType: "lead", objectId: "lead-1", kind: null } });
  });
  it("ignores events unrelated to the CRM and private events, and rejects unreadable times", () => {
    expect(mapEvent({ id: "x", summary: "Dentist", start: { dateTime: "2026-11-11T09:00:00Z" }, end: { dateTime: "2026-11-11T09:30:00Z" }, attendees: [{ email: "stranger@example.com" }] }, ctx)).toEqual({ ok: false, reason: "not_crm_related" });
    expect(mapEvent({ ...stamped, visibility: "private" }, ctx)).toEqual({ ok: false, reason: "private_event" });
    expect(mapEvent({ ...stamped, start: { dateTime: "nonsense" } }, ctx)).toEqual({ ok: false, reason: "bad_time" });
    expect(mapEvent({ ...stamped, end: { dateTime: "2026-11-10T09:00:00+05:30" } }, ctx)).toEqual({ ok: false, reason: "bad_time" });
    expect(mapEvent({ ...stamped, start: undefined }, ctx)).toEqual({ ok: false, reason: "no_time" });
  });
  it("turns a bare cancellation into a cancel instruction", () => {
    expect(mapEvent({ id: "e1", status: "cancelled" }, ctx)).toEqual({ ok: true, kind: "cancel", externalId: "u1:e1" });
  });
  it("drops stamped object links that do not look like record references", () => {
    const r = mapEvent({ ...stamped, extendedProperties: { private: { crm_kind: "meeting", crm_object_type: "lead; drop", crm_object_id: "x" } } }, ctx);
    expect(r).toMatchObject({ ok: true, row: { objectType: null, objectId: null, kind: "meeting" } });
  });
});

describe("zonedMidnightIso", () => {
  it("handles zones east and west of UTC and falls back to UTC for a bad zone", () => {
    expect(zonedMidnightIso("2026-06-15", "Asia/Kolkata")).toBe("2026-06-14T18:30:00.000Z");
    expect(zonedMidnightIso("2026-01-15", "America/New_York")).toBe("2026-01-15T05:00:00.000Z");
    expect(zonedMidnightIso("2026-01-15", "Not/AZone")).toBe("2026-01-15T00:00:00.000Z");
    expect(zonedMidnightIso("garbage")).toBe("");
  });
});

describe("outbound mapping and conflict rule", () => {
  const local = { title: "Hold", startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-12-02T00:00:00Z", status: "tentative" as const, objectType: "obj:booking", objectId: "rec-1" };
  it("stamps the CRM link and kind so the event maps back to the same record", () => {
    const body = toGoogleEvent(local, kindForLocal(local));
    expect(body).toMatchObject({ summary: "Hold", status: "tentative", extendedProperties: { private: { crm_kind: "room_hold", crm_object_type: "obj:booking", crm_object_id: "rec-1" } } });
    const back = mapEvent({ id: "g", ...(body as object), start: { dateTime: "2026-12-01T00:00:00Z" }, end: { dateTime: "2026-12-02T00:00:00Z" } } as GEvent, ctx);
    expect(back).toMatchObject({ ok: true, row: { kind: "room_hold", objectId: "rec-1" } });
    expect(kindForLocal({ status: "confirmed", objectType: "lead" })).toBe("meeting");
  });
  it("last write wins: equal content is a no-op, a newer local edit is kept, an older one is overwritten", () => {
    const remote = { remoteUpdated: "2026-11-02T00:00:00Z", title: "A", startsAt: "2026-11-10T00:00:00Z", endsAt: "2026-11-10T01:00:00Z", status: "confirmed" as const };
    const sig = sigOf(remote);
    expect(decideInbound(undefined, remote)).toBe("apply");
    expect(decideInbound({ updatedAt: "2026-11-03T00:00:00Z", sig }, remote)).toBe("same");
    expect(decideInbound({ updatedAt: "2026-11-03T00:00:00Z", sig: "other" }, remote)).toBe("keep_local");
    expect(decideInbound({ updatedAt: "2026-11-01T00:00:00Z", sig: "other" }, remote)).toBe("apply");
  });
});
