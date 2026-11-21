// Staging only. Written, NOT run (light mode).
// iCal fallback: the public availability feed behind an unguessable per-property token, and (when an owner session is configured)
// that imported calendar dates show up as OTA-labelled bookings. The route /api/ical/<token>.ics is wired by the integrator
// (not in T046's Owns); the logic is handleFeedRequest in src/lib/connectors/ical/export.ts.
//   CYPRESS_ICAL_TOKEN        = a live export token for a property that has at least one blocked date (plaintext, shown once at creation)
//   CYPRESS_ICAL_REVOKED_TOKEN = optional: a token that was revoked
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = owner of the same workspace (only for the bookings check)
describe("connectors: iCal export feed and import", () => {
  const token = () => Cypress.expose("ICAL_TOKEN") as string | undefined;
  const feed = (t: string) => cy.request({ url: `/api/ical/${t}.ics`, failOnStatusCode: false });

  it("serves blocked dates as text/calendar with dates only", function () {
    if (!token()) return this.skip();
    feed(token() as string).then((res) => {
      expect(res.status).to.eq(200);
      expect(res.headers["content-type"]).to.match(/^text\/calendar/);
      expect(res.headers["x-robots-tag"]).to.eq("noindex");
      expect(res.body).to.match(/^BEGIN:VCALENDAR\r\n/);
      expect(res.body).to.contain("DTSTART;VALUE=DATE:");
      expect(res.body).to.contain("SUMMARY:Not available");
      expect(res.body).not.to.match(/ATTENDEE|DESCRIPTION|LOCATION|@/);
    });
  });

  it("answers the same 404 for unknown, malformed and revoked tokens", function () {
    const unknown = "A".repeat(43);
    feed(unknown).then((a) => {
      expect(a.status).to.eq(404);
      expect(a.body).not.to.contain("BEGIN:VCALENDAR");
      feed("short").then((b) => { expect(b.status).to.eq(404); expect(b.body).to.eq(a.body); });
      feed("' or 1=1 --").then((c) => { expect(c.status).to.eq(404); expect(c.body).to.eq(a.body); });
      const revoked = Cypress.expose("ICAL_REVOKED_TOKEN") as string | undefined;
      if (revoked) feed(revoked).then((d) => { expect(d.status).to.eq(404); expect(d.body).to.eq(a.body); });
    });
  });

  it("is read-only: no write method is accepted", function () {
    if (!token()) return this.skip();
    cy.request({ method: "POST", url: `/api/ical/${token()}.ics`, failOnStatusCode: false }).its("status").should("be.oneOf", [404, 405]);
  });

  it("shows imported calendar dates as bookings labelled with their OTA", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/o/booking");
    cy.get("main").invoke("text").should("match", /Airbnb|Booking.com/);
  });
});
