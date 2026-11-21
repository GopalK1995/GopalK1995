import { describe, expect, it } from "vitest";
import { IcalParseError, looksLikeIcs, parseDuration, parseIcs } from "../parser";
import { classify, dedupeByUid, eventToStay } from "../stays";
import { airbnbFeed } from "./fakes";

const wrap = (...ev: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...ev, "END:VCALENDAR"].join("\r\n");
const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

describe("RFC 5545 parser", () => {
  it("reads an Airbnb-style feed and unfolds, unescapes and ignores nested components", () => {
    const text = wrap(
      "BEGIN:VTIMEZONE", "TZID:Fake/Zone", "END:VTIMEZONE",
      vevent("UID:abc-1", "DTSTART;VALUE=DATE:20310310", "DTEND;VALUE=DATE:20310313", "SUMMARY:Reserved\\, with a very long summary that needs to be folded onto the next ", " line because it is over seventy-five octets", "BEGIN:VALARM", "TRIGGER:-PT1H", "SUMMARY:alarm", "END:VALARM"),
    );
    const r = parseIcs(text);
    expect(r.rejected).toEqual([]);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ uid: "abc-1", dtstart: { kind: "date", date: "2031-03-10" }, dtend: { kind: "date", date: "2031-03-13" } });
    expect(r.events[0].summary).toBe("Reserved, with a very long summary that needs to be folded onto the next line because it is over seventy-five octets");
  });
  it("accepts LF-only and CR-only line ends", () => {
    const lf = wrap(vevent("UID:1", "DTSTART;VALUE=DATE:20310310")).replace(/\r\n/g, "\n");
    expect(parseIcs(lf).events).toHaveLength(1);
    expect(parseIcs(lf.replace(/\n/g, "\r")).events).toHaveLength(1);
  });
  it("parses UTC, TZID and floating date-times and keeps quoted parameter values intact", () => {
    const r = parseIcs(wrap(
      vevent("UID:u", "DTSTART:20310310T093000Z", "DTEND:20310311T110000Z"),
      vevent("UID:z", 'DTSTART;TZID="Asia/Kolkata":20310310T140000', "DTEND;TZID=Asia/Kolkata:20310311T110000"),
      vevent("UID:f", "DTSTART:20310310T140000", 'ATTENDEE;CN="Doe, Jane: Test":mailto:x@example.test'),
    ));
    expect(r.events.map((e) => e.dtstart?.kind)).toEqual(["utc", "zoned", "floating"]);
    expect(r.events[1].dtstart).toMatchObject({ tzid: "Asia/Kolkata", wall: { h: 14 } });
  });
  it("reads STATUS, SEQUENCE, LAST-MODIFIED and DURATION", () => {
    const r = parseIcs(wrap(vevent("UID:a", "DTSTART;VALUE=DATE:20310310", "DURATION:P3D", "STATUS:cancelled", "SEQUENCE:4", "LAST-MODIFIED:20310301T080000Z")));
    expect(r.events[0]).toMatchObject({ status: "CANCELLED", sequence: 4, duration: { days: 3, ms: 0 }, lastModifiedMs: Date.UTC(2031, 2, 1, 8) });
    expect(parseDuration("P1W")).toEqual({ days: 7, ms: 0 });
    expect(parseDuration("PT1H30M")).toEqual({ days: 0, ms: 5_400_000 });
    expect(parseDuration("P")).toBeNull();
    expect(parseDuration("-P1D")).toBeNull();
    expect(parseDuration("nonsense")).toBeNull();
  });
  it("rejects what it cannot trust instead of guessing, and keeps the good events", () => {
    const r = parseIcs(wrap(
      vevent("UID:ok", "DTSTART;VALUE=DATE:20310310"),
      vevent("DTSTART;VALUE=DATE:20310310"),                                     // no uid
      vevent("UID:nostart"),                                                     // no start
      vevent("UID:badstart", "DTSTART;VALUE=DATE:20310231"),                     // 31 Feb
      vevent("UID:rr", "DTSTART;VALUE=DATE:20310310", "RRULE:FREQ=DAILY;COUNT=3"), // recurrence unsupported
      vevent("UID:baddur", "DTSTART;VALUE=DATE:20310310", "DURATION:xyz"),
    ));
    expect(r.events.map((e) => e.uid)).toEqual(["ok"]);
    expect(r.rejected.map((x) => x.reason).sort()).toEqual(["bad_duration", "bad_start", "no_start", "no_uid", "recurrence_unsupported"]);
  });
  it("throws not_ical for non-calendars and survives hostile input", () => {
    expect(() => parseIcs("<html>login</html>")).toThrow(IcalParseError);
    expect(looksLikeIcs("<html>")).toBe(false);
    expect(looksLikeIcs("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(() => parseIcs(wrap("BEGIN:VEVENT", "UID:" + "x".repeat(20000), "END:VEVENT"))).not.toThrow();
    expect(parseIcs(wrap("END:VEVENT", "END:VEVENT", "BEGIN:VEVENT")).events).toEqual([]);
    expect(parseIcs(wrap(vevent("UID:q", 'SUMMARY;X="unterminated:val', "DTSTART;VALUE=DATE:20310310"))).events.length).toBeLessThanOrEqual(1);
  });
  it("caps the number of events", () => {
    const many = wrap(...Array.from({ length: 5200 }, (_, i) => vevent(`UID:e${i}`, "DTSTART;VALUE=DATE:20310310")));
    const r = parseIcs(many);
    expect(r.events.length).toBe(5000);
    expect(r.rejected.some((x) => x.reason === "too_many_events")).toBe(true);
  });
  it("parses the Airbnb fixture builder output", () => {
    const r = parseIcs(airbnbFeed([{ uid: "a", start: "20310310", end: "20310313" }, { uid: "b", start: "20310320", end: "20310322", summary: "Airbnb (Not available)" }]));
    expect(r.events).toHaveLength(2);
  });
});

const ev = (lines: string[]) => parseIcs(wrap(vevent(...lines))).events[0];

describe("stays: dates, time zones, kinds", () => {
  it("treats the all-day DTEND as exclusive check-out", () => {
    const s = eventToStay(ev(["UID:1", "DTSTART;VALUE=DATE:20310310", "DTEND;VALUE=DATE:20310313"]), { zone: "Asia/Kolkata", source: "airbnb" });
    expect(s).toMatchObject({ ok: true, stay: { checkIn: "2031-03-10", checkOut: "2031-03-13", kind: "reservation", cancelled: false } });
  });
  it("lasts one day when an all-day event has no end, and honours DURATION", () => {
    expect(eventToStay(ev(["UID:1", "DTSTART;VALUE=DATE:20310310"]), { zone: "UTC", source: "airbnb" })).toMatchObject({ ok: true, stay: { checkOut: "2031-03-11" } });
    expect(eventToStay(ev(["UID:1", "DTSTART;VALUE=DATE:20310310", "DURATION:P2D"]), { zone: "UTC", source: "airbnb" })).toMatchObject({ ok: true, stay: { checkOut: "2031-03-12" } });
  });
  it("converts instants to the property's calendar date (UTC late evening is the next day in India)", () => {
    const s = eventToStay(ev(["UID:1", "DTSTART:20310310T203000Z", "DTEND:20310312T050000Z"]), { zone: "Asia/Kolkata", source: "other" });
    expect(s).toMatchObject({ ok: true, stay: { checkIn: "2031-03-11", checkOut: "2031-03-12" } });
  });
  it("reads a TZID wall time in that zone and handles a different property zone (DST)", () => {
    const s = eventToStay(ev(["UID:1", "DTSTART;TZID=America/New_York:20310710T230000", "DTEND;TZID=America/New_York:20310712T100000"]), { zone: "Asia/Kolkata", source: "other" });
    // 23:00 EDT = 03:00 UTC next day = 08:30 IST on the 11th
    expect(s).toMatchObject({ ok: true, stay: { checkIn: "2031-07-11", checkOut: "2031-07-12" } });
  });
  it("falls back to the property zone for an unknown TZID and says so", () => {
    const s = eventToStay(ev(["UID:1", "DTSTART;TZID=India Standard Time:20310310T100000", "DTEND;TZID=India Standard Time:20310311T100000"]), { zone: "Asia/Kolkata", source: "other" });
    expect(s).toMatchObject({ ok: true, stay: { checkIn: "2031-03-10", warnings: ["tz_unknown", "tz_unknown"] } });
  });
  it("reads a floating time in the property zone", () => {
    const s = eventToStay(ev(["UID:1", "DTSTART:20310310T230000", "DTEND:20310311T100000"]), { zone: "Asia/Kolkata", source: "other" });
    expect(s).toMatchObject({ ok: true, stay: { checkIn: "2031-03-10", checkOut: "2031-03-11" } });
  });
  it("closes the night for a same-day timed event and rejects empty or absurd date ranges", () => {
    expect(eventToStay(ev(["UID:1", "DTSTART:20310310T100000Z", "DTEND:20310310T140000Z"]), { zone: "UTC", source: "other" })).toMatchObject({ ok: true, stay: { checkIn: "2031-03-10", checkOut: "2031-03-11" } });
    expect(eventToStay(ev(["UID:1", "DTSTART;VALUE=DATE:20310310", "DTEND;VALUE=DATE:20310310"]), { zone: "UTC", source: "other" })).toEqual({ ok: false, reason: "empty_range" });
    expect(eventToStay(ev(["UID:1", "DTSTART;VALUE=DATE:20310310", "DTEND;VALUE=DATE:20330310"]), { zone: "UTC", source: "other" })).toEqual({ ok: false, reason: "range_too_long" });
  });
  it("marks cancelled events and classifies blocks vs reservations per source", () => {
    expect(eventToStay(ev(["UID:1", "DTSTART;VALUE=DATE:20310310", "STATUS:CANCELLED"]), { zone: "UTC", source: "airbnb" })).toMatchObject({ ok: true, stay: { cancelled: true } });
    expect(classify("airbnb", "Reserved")).toBe("reservation");
    expect(classify("airbnb", "Airbnb (Not available)")).toBe("block");
    expect(classify("booking_com", "CLOSED - Not available")).toBe("block");
    expect(classify("other", "Maintenance block")).toBe("block");
  });
  it("keeps only the newest version of a UID", () => {
    const mk = (seq: number, mod: number | null, checkOut: string) => ({ uid: "u", checkIn: "2031-03-10", checkOut, kind: "reservation" as const, cancelled: false, sequence: seq, modifiedMs: mod, warnings: [] });
    expect(dedupeByUid([mk(1, null, "2031-03-12"), mk(2, null, "2031-03-14"), mk(1, null, "2031-03-16")])).toEqual([mk(2, null, "2031-03-14")]);
    expect(dedupeByUid([mk(1, 5, "2031-03-12"), mk(1, 9, "2031-03-14")])[0].checkOut).toBe("2031-03-14");
  });
  it("never keeps the summary or description (guest details) on a stay", () => {
    const s = eventToStay(ev(["UID:1", "DTSTART;VALUE=DATE:20310310", "SUMMARY:Jane Doe", "DESCRIPTION:Phone 4321"]), { zone: "UTC", source: "airbnb" });
    expect(JSON.stringify(s)).not.toContain("Jane");
    expect(JSON.stringify(s)).not.toContain("4321");
  });
});
