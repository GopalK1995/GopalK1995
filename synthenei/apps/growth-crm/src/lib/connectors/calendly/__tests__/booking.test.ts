import { beforeEach, describe, expect, it } from "vitest";
import { parseCalcom } from "../../calcom/payload";
import { handleBooking } from "../booking";
import { parseCalendly } from "../payload";
import * as F from "./fixtures";
import { CONN, FakeStore, OWNER, REP, TENANT, WS, mkConn, mkDeps } from "./fake-store";
import type { ConnectionRow } from "../../core/types";

let st: FakeStore, rejects: string[];
const run = async (events: ReturnType<typeof parseCalendly>, conn: ConnectionRow = mkConn()) => { for (const e of events) await handleBooking({ deps: mkDeps(st), conn, reject: (r) => rejects.push(r) }, e); };
const fresh = () => { st = new FakeStore(); st.leads.push({ id: "lead-1", workspaceId: WS, email: "pat.example@example.test", ownerId: REP }); };
beforeEach(() => { fresh(); rejects = []; });

describe("booked", () => {
  it("matches the lead by email (case-insensitive) and writes a calendar row, a prep task, an owner notice and one event", async () => {
    await run(parseCalendly(F.calendlyCreated()));
    expect(st.rows).toHaveLength(1);
    expect(st.rows[0]).toMatchObject({ leadId: "lead-1", status: "confirmed", integrationId: CONN, workspaceId: WS });
    expect(st.tasks).toEqual([expect.objectContaining({ leadId: "lead-1", assigneeId: REP, kind: "demo_prep", priority: 1, dueAt: "2030-03-04T04:30:00.000Z", tenantId: TENANT })]);
    expect(st.tasks[0].title).toContain("Pat Example");
    expect(st.notices.map((n) => [n.user, n.kind, n.url])).toEqual([[REP, "booking.created", "/leads/lead-1"]]);
    expect(st.notices[0].title.en).toBe("New booking: Pat Example");
    expect(Object.keys(st.notices[0].title)).toEqual(["en", "ta"]);
    expect(st.events.map((e) => e.type)).toEqual(["booking.created"]);
    expect(rejects).toEqual([]);
  });
  it("events and calendar rows never carry the email or the name", async () => {
    await run(parseCalendly(F.calendlyCreated()));
    expect(JSON.stringify(st.events)).not.toMatch(/example\.test|Pat/i);
    expect(JSON.stringify(st.rows)).not.toMatch(/example\.test|Pat/i);
  });
  it("a lead with no owner notifies the workspace owners", async () => {
    st.leads[0].ownerId = null;
    await run(parseCalendly(F.calendlyCreated()));
    expect(st.notices.map((n) => n.user)).toEqual([OWNER]);
    expect(st.tasks[0].assigneeId).toBeNull();
  });
  it("a start time already inside the prep hour makes the task due now, never in the past", async () => {
    await handleBooking({ deps: mkDeps(st, "2030-03-04T05:20:00.000Z"), conn: mkConn() }, parseCalendly(F.calendlyCreated())[0]);
    expect(st.tasks[0].dueAt).toBe("2030-03-04T05:20:00.000Z");
  });
});

describe("unknown email", () => {
  it("creates only the unmatched-booking record: calendar row without a link, owner notice, unmatched event. No lead, no task.", async () => {
    await run(parseCalendly(F.calendlyCreated({ email: "stranger@elsewhere.test" })));
    expect(st.rows).toHaveLength(1);
    expect(st.rows[0].leadId).toBeNull();
    expect(st.leads).toHaveLength(1);
    expect(st.tasks).toEqual([]);
    expect(st.notices.map((n) => [n.user, n.kind, n.objectId])).toEqual([[OWNER, "booking.unmatched", null]]);
    expect(st.events.map((e) => e.type)).toEqual(["booking.unmatched"]);
  });
  it("a booking with no email at all is also unmatched", async () => {
    await run(parseCalendly(F.calendlyCreated({ email: undefined })));
    expect(st.tasks).toEqual([]);
    expect(st.events.map((e) => e.type)).toEqual(["booking.unmatched"]);
  });
  it("a soft-deleted lead is not matched", async () => {
    st.leads[0].deleted = true;
    await run(parseCalendly(F.calendlyCreated()));
    expect(st.tasks).toEqual([]);
  });
});

describe("cancelled", () => {
  it("marks the row cancelled, makes a follow-up task and notifies the owner", async () => {
    await run(parseCalendly(F.calendlyCreated()));
    await run(parseCalendly(F.calendlyCanceled()));
    expect(st.rows[0].status).toBe("cancelled");
    expect(st.tasks.map((t) => t.kind)).toEqual(["demo_prep", "follow_up"]);
    expect(st.notices.map((n) => n.kind)).toEqual(["booking.created", "booking.cancelled"]);
    expect(st.events.map((e) => e.type)).toEqual(["booking.created", "booking.cancelled"]);
  });
  it("a cancellation arriving BEFORE its booking is applied and the late booking never resurrects it", async () => {
    await run(parseCalendly(F.calendlyCanceled()));
    await run(parseCalendly(F.calendlyCreated()));
    expect(st.rows).toHaveLength(1);
    expect(st.rows[0].status).toBe("cancelled");
    expect(st.notices.map((n) => n.kind)).toEqual(["booking.cancelled"]);
  });
  it("cancelling an unmatched booking tells the owners and still creates no task", async () => {
    await run(parseCalendly(F.calendlyCreated({ email: "stranger@elsewhere.test" })));
    await run(parseCalendly(F.calendlyCanceled({ email: "stranger@elsewhere.test" })));
    expect(st.tasks).toEqual([]);
    expect(st.notices).toHaveLength(2);
  });
});

describe("idempotency", () => {
  it("replaying the same delivery changes nothing (rows, tasks, notices, events)", async () => {
    for (let i = 0; i < 3; i++) await run(parseCalendly(F.calendlyCreated()));
    for (let i = 0; i < 3; i++) await run(parseCalendly(F.calendlyCanceled()));
    expect([st.rows.length, st.tasks.length, st.notices.length, st.events.length]).toEqual([1, 2, 2, 2]);
  });
  it("two bookings by the same lead at the same time keep their own tasks", async () => {
    await run(parseCalendly(F.calendlyCreated()));
    await run(parseCalendly(F.calendlyCreated({ uri: "https://api.calendly.com/scheduled_events/EV2/invitees/INV2" })));
    expect(st.tasks).toHaveLength(2);
  });
});

describe("reschedule", () => {
  it("Calendly: the old half is silent, the new booking gets one task and one notice", async () => {
    await run(parseCalendly(F.calendlyCreated()));
    await run(parseCalendly(F.calendlyCanceled({ rescheduled: true })));
    await run(parseCalendly(F.calendlyCreated({ uri: "https://api.calendly.com/scheduled_events/EV2/invitees/INV2", old_invitee: "https://api.calendly.com/scheduled_events/EV1/invitees/INV1" })));
    expect(st.rows.map((r) => r.status)).toEqual(["cancelled", "confirmed"]);
    expect(st.notices.map((n) => n.kind)).toEqual(["booking.created", "booking.created"]);
    expect(st.tasks.every((t) => t.kind === "demo_prep")).toBe(true);
  });
  it("Cal.com: BOOKING_RESCHEDULED cancels the old uid silently and books the new one; an unseen old uid creates no row", async () => {
    const conn = mkConn({ connectorId: "cal-com" });
    await run(parseCalcom(F.calCreated()), conn);
    await run(parseCalcom(F.calRescheduled()), conn);
    expect(st.rows.map((r) => [r.externalId, r.status])).toEqual([["calUID1", "cancelled"], ["calUID2", "confirmed"]]);
    fresh();
    await run(parseCalcom(F.calRescheduled()), conn);
    expect(st.rows.map((r) => r.externalId)).toEqual(["calUID2"]);
  });
});

describe("tenant isolation", () => {
  it("matches leads only in the connection's workspace; the same email in another workspace is never touched", async () => {
    st.leads = [{ id: "lead-other", workspaceId: "ws-2", email: "pat.example@example.test", ownerId: "user-x" }];
    await run(parseCalendly(F.calendlyCreated()));
    expect(st.tasks).toEqual([]);
    expect(st.rows[0].leadId).toBeNull();
    expect(st.notices.map((n) => n.user)).toEqual([OWNER]);
  });
  it("the same vendor booking id on two connections gives two independent rows and notices", async () => {
    st.owners["ws-2"] = ["owner-2"];
    await run(parseCalendly(F.calendlyCreated()));
    await run(parseCalendly(F.calendlyCreated()), mkConn({ id: "conn-2", workspaceId: "ws-2", tenantId: "t-2" }));
    expect(st.rows.map((r) => [r.integrationId, r.workspaceId])).toEqual([["conn-1", WS], ["conn-2", "ws-2"]]);
    expect(st.notices.filter((n) => n.workspaceId === "ws-2").map((n) => n.user)).toEqual(["owner-2"]);
  });
});

describe("rejects and settings", () => {
  it("a booking without usable times is rejected and writes nothing", async () => {
    await run(parseCalendly(JSON.stringify({ event: "invitee.created", payload: { uri: "u", email: "a@b.test", scheduled_event: { name: "x" } } })));
    expect(rejects).toEqual(["bad_time"]);
    expect(st.rows).toEqual([]);
  });
  it("ignored events do nothing", async () => {
    await run(parseCalendly(JSON.stringify({ event: "routing_form_submission.created", payload: { uri: "u" } })));
    expect(st.rows).toEqual([]);
    expect(rejects).toEqual([]);
  });
  it("display_timezone changes how the start is printed; a bad zone falls back to the default", async () => {
    await run(parseCalendly(F.calendlyCreated()), mkConn({ settings: { display_timezone: "America/New_York" } }));
    expect(st.notices[0].body.en).toMatch(/12:30\s?am/i);
    fresh();
    await run(parseCalendly(F.calendlyCreated()), mkConn({ settings: { display_timezone: "Not/AZone" } }));
    expect(st.notices[0].body.en).toMatch(/11:00\s?am/i);
  });
});
