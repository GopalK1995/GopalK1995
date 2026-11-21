// Staging only. Written, NOT run (light mode).
// Part 1 (no setup): the receiver contract for Calendly: an unknown connection or a missing/forged signature never reaches the CRM.
// Part 2 (needs a connected Calendly connection on a PAID Calendly plan, or just its signing key since the delivery here is simulated):
//   a signed invitee.created for a lead's email is accepted, a replay is a duplicate, a tampered body is 401; the job then creates the
//   demo-prep task for that lead and notifies the lead's owner; a signed invitee.canceled adds the follow-up task.
//   CYPRESS_CALENDLY_CONNECTION = integration id of the connected Calendly connection
//   CYPRESS_CALENDLY_SIGNING_KEY = the signing key stored with it
//   CYPRESS_CALENDLY_LEAD_EMAIL = email of an existing lead in that workspace
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace (reads the task list for real)
import { createHmac } from "crypto";

const hook = (conn: string) => `/api/hooks/calendly/${conn}`;
const FAKE = "11111111-1111-4111-8111-111111111111";
const sign = (key: string, body: string) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac("sha256", key).update(`${t}.${body}`, "utf8").digest("hex")}`; };
const invitee = (event: string, email: string, uid: string, start: Date) =>
  JSON.stringify({
    event, created_at: new Date().toISOString(),
    payload: {
      uri: `https://api.calendly.com/scheduled_events/cy${uid}/invitees/cy${uid}`, email, name: "Cypress Invitee", rescheduled: false, old_invitee: null,
      scheduled_event: { name: "Cypress intro call", start_time: start.toISOString(), end_time: new Date(start.getTime() + 1_800_000).toISOString() },
      ...(event === "invitee.canceled" ? { cancellation: { reason: "Cypress" } } : {}),
    },
  });

describe("connectors: Calendly booked", () => {
  it("an unknown connection or a missing signature never reaches the CRM", () => {
    cy.request({ method: "POST", url: hook(FAKE), body: "{}", failOnStatusCode: false }).then((r) => {
      expect(r.status).to.eq(404);
      expect(r.body).to.deep.eq({ ok: false });
    });
    const conn = Cypress.expose("CALENDLY_CONNECTION") as string | undefined;
    if (!conn) return;
    cy.request({ method: "POST", url: hook(conn), body: invitee("invitee.created", "x@example.test", "a", new Date()), headers: { "content-type": "application/json" }, failOnStatusCode: false }).its("status").should("eq", 401);
  });

  it("signed booking -> accepted, replay -> duplicate, tampered -> 401, then the lead's task list loads", function () {
    const g = (k: string) => Cypress.expose(k) as string | undefined;
    const conn = g("CALENDLY_CONNECTION"), key = g("CALENDLY_SIGNING_KEY"), lead = g("CALENDLY_LEAD_EMAIL"), email = g("OWNER_EMAIL"), password = g("OWNER_PASSWORD");
    if (!conn || !key || !lead || !email || !password) return this.skip();
    const uid = Date.now().toString(36);
    const body = invitee("invitee.created", lead, uid, new Date(Date.now() + 86_400_000));
    const headers = { "content-type": "application/json", "calendly-webhook-signature": sign(key, body) };
    cy.request({ method: "POST", url: hook(conn), body, headers }).its("body.ok").should("eq", true);
    cy.request({ method: "POST", url: hook(conn), body, headers }).its("body.duplicate").should("eq", true);
    cy.request({ method: "POST", url: hook(conn), body: body + " ", headers, failOnStatusCode: false }).its("status").should("eq", 401);
    const cancel = invitee("invitee.canceled", lead, uid, new Date(Date.now() + 86_400_000));
    cy.request({ method: "POST", url: hook(conn), body: cancel, headers: { "content-type": "application/json", "calendly-webhook-signature": sign(key, cancel) } }).its("body.ok").should("eq", true);
    // The job drains within a minute or two on staging; the demo-prep and follow-up tasks then show on /tasks for the owner.
    cy.loginReal({ email, password });
    cy.visit("/tasks");
    cy.get("main", { timeout: 120000 }).should("be.visible");
    cy.contains("Cypress Invitee", { timeout: 120000 }).should("exist");
  });
});
