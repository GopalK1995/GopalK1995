import { describe, expect, it } from "vitest";
import { parseCalcom } from "../../calcom/payload";
import { parseCalendly } from "../payload";
import * as F from "./fixtures";

describe("Calendly mapper", () => {
  it("maps invitee.created: lower-cased email, event type as title, ISO times", () => {
    expect(parseCalendly(F.calendlyCreated())).toEqual([{ kind: "booked", vendor: "calendly", externalId: "https://api.calendly.com/scheduled_events/EV1/invitees/INV1", email: "pat.example@example.test", name: "Pat Example", title: "Intro call", startsAt: "2030-03-04T05:30:00.000Z", endsAt: "2030-03-04T06:00:00.000Z", rescheduled: false, reason: undefined }]);
  });
  it("maps invitee.canceled with its reason, and flags both halves of a reschedule", () => {
    expect(parseCalendly(F.calendlyCanceled())[0]).toMatchObject({ kind: "cancelled", rescheduled: false, reason: "Clash" });
    expect(parseCalendly(F.calendlyCanceled({ rescheduled: true }))[0]).toMatchObject({ kind: "cancelled", rescheduled: true });
    expect(parseCalendly(F.calendlyCreated({ old_invitee: "https://api.calendly.com/scheduled_events/EV0/invitees/INV0" }))[0]).toMatchObject({ kind: "booked", rescheduled: true });
  });
  it("ignores other events, and returns nothing for malformed bodies", () => {
    expect(parseCalendly(JSON.stringify({ event: "routing_form_submission.created", payload: { uri: "x" } }))[0].kind).toBe("ignored");
    for (const b of ["", "not json", "[]", "{}", JSON.stringify({ event: "invitee.created" })]) expect(parseCalendly(b)).toEqual([]);
  });
  it("a missing or invalid email maps to null (never guessed)", () => {
    expect(parseCalendly(F.calendlyCreated({ email: "not-an-email" }))[0].email).toBeNull();
    expect(parseCalendly(F.calendlyCreated({ email: undefined }))[0].email).toBeNull();
  });
});

describe("Cal.com mapper", () => {
  it("maps BOOKING_CREATED and BOOKING_CANCELLED", () => {
    expect(parseCalcom(F.calCreated())).toEqual([expect.objectContaining({ kind: "booked", vendor: "cal-com", externalId: "calUID1", email: "pat.example@example.test", title: "Intro call", rescheduled: false })]);
    expect(parseCalcom(F.calCancelled())[0]).toMatchObject({ kind: "cancelled", externalId: "calUID1", reason: "Clash" });
  });
  it("BOOKING_RESCHEDULED = silent cancel of the old uid + a booking for the new uid", () => {
    const [old, neu] = parseCalcom(F.calRescheduled());
    expect(old).toMatchObject({ kind: "cancelled", externalId: "calUID1", rescheduled: true });
    expect(neu).toMatchObject({ kind: "booked", externalId: "calUID2", rescheduled: true });
  });
  it("ignores other triggers, no attendee gives a null email, malformed gives nothing", () => {
    expect(parseCalcom(JSON.stringify({ triggerEvent: "MEETING_ENDED", payload: { uid: "u" } }))[0].kind).toBe("ignored");
    expect(parseCalcom(F.calCreated({ attendees: [] }))[0].email).toBeNull();
    for (const b of ["", "nope", "{}", JSON.stringify({ triggerEvent: "BOOKING_CREATED" })]) expect(parseCalcom(b)).toEqual([]);
  });
});
