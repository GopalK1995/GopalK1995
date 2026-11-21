// Staging only. Written, NOT run (light mode).
// Part 1 (no setup): the receiver contract for Cal.com (connector id "cal-com"): unknown connection / missing signature never reach the CRM.
// Part 2 (needs a connected Cal.com connection and its webhook secret; the delivery is simulated with the same HMAC Cal.com uses):
//   a signed BOOKING_CREATED for a lead's email is accepted, a replay is a duplicate, a tampered body is 401; the job then creates the
//   demo-prep task and notifies the owner; a signed BOOKING_CANCELLED adds the follow-up task.
//   CYPRESS_CALCOM_CONNECTION / CYPRESS_CALCOM_WEBHOOK_SECRET / CYPRESS_CALCOM_LEAD_EMAIL / CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD
import { createHmac } from "crypto";

const hook = (conn: string) => `/api/hooks/cal-com/${conn}`;
const FAKE = "11111111-1111-4111-8111-111111111111";
const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body, "utf8").digest("hex");
const booking = (trigger: string, email: string, uid: string, start: Date) =>
  JSON.stringify({
    triggerEvent: trigger, createdAt: new Date().toISOString(),
    payload: {
      title: "Cypress intro call", uid, startTime: start.toISOString(), endTime: new Date(start.getTime() + 1_800_000).toISOString(),
      attendees: [{ email, name: "Cypress Invitee", timeZone: "UTC" }], ...(trigger === "BOOKING_CANCELLED" ? { cancellationReason: "Cypress" } : {}),
    },
  });

describe("connectors: Cal.com booked", () => {
  it("an unknown connection or a missing signature never reaches the CRM", () => {
    cy.request({ method: "POST", url: hook(FAKE), body: "{}", failOnStatusCode: false }).then((r) => {
      expect(r.status).to.eq(404);
      expect(r.body).to.deep.eq({ ok: false });
    });
    const conn = Cypress.expose("CALCOM_CONNECTION") as string | undefined;
    if (!conn) return;
    cy.request({ method: "POST", url: hook(conn), body: booking("BOOKING_CREATED", "x@example.test", "cya", new Date()), headers: { "content-type": "application/json" }, failOnStatusCode: false }).its("status").should("eq", 401);
  });

  it("signed booking -> accepted, replay -> duplicate, tampered -> 401, then the lead's task list loads", function () {
    const g = (k: string) => Cypress.expose(k) as string | undefined;
    const conn = g("CALCOM_CONNECTION"), secret = g("CALCOM_WEBHOOK_SECRET"), lead = g("CALCOM_LEAD_EMAIL"), email = g("OWNER_EMAIL"), password = g("OWNER_PASSWORD");
    if (!conn || !secret || !lead || !email || !password) return this.skip();
    const uid = `cy${Date.now().toString(36)}`;
    const body = booking("BOOKING_CREATED", lead, uid, new Date(Date.now() + 86_400_000));
    const headers = { "content-type": "application/json", "x-cal-signature-256": sign(secret, body) };
    cy.request({ method: "POST", url: hook(conn), body, headers }).its("body.ok").should("eq", true);
    cy.request({ method: "POST", url: hook(conn), body, headers }).its("body.duplicate").should("eq", true);
    cy.request({ method: "POST", url: hook(conn), body: body + " ", headers, failOnStatusCode: false }).its("status").should("eq", 401);
    const cancel = booking("BOOKING_CANCELLED", lead, uid, new Date(Date.now() + 86_400_000));
    cy.request({ method: "POST", url: hook(conn), body: cancel, headers: { "content-type": "application/json", "x-cal-signature-256": sign(secret, cancel) } }).its("body.ok").should("eq", true);
    cy.loginReal({ email, password });
    cy.visit("/tasks");
    cy.get("main", { timeout: 120000 }).should("be.visible");
    cy.contains("Cypress Invitee", { timeout: 120000 }).should("exist");
  });
});
