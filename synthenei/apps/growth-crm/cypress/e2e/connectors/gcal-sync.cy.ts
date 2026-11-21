// Staging only. Written, NOT run (light mode).
// Google Calendar two-way sync against the Showcase gateway (sample calendar, no network) or a stub base (GOOGLE_CALENDAR_API_BASE).
// The pull / push streams run every 15 minutes; this spec runs them with "Run sync now" and reads the sync log.
//   CYPRESS_GCAL_CONNECTION = integration id of a connected google-calendar connection (Showcase or stub base)
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace
import { clickUntil, clickLinkUntilPath } from "../../support/retry-click";

describe("connectors: Google Calendar sync", () => {
  it("lists Google Calendar in a demo session as a showcase, not as connected", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    clickLinkUntilPath(() => cy.contains("main a", /google calendar/i), /\/integrations\/google-calendar/);
    cy.get("main").should("contain.text", "Google Calendar");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("a sync run pulls CRM-related events and pushes CRM-side events, and the log shows both streams (real owner session)", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!Cypress.expose("GCAL_CONNECTION") || !email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/integrations/google-calendar");
    clickUntil(() => cy.contains("main button", /sync now/i), ($b) => /sync/i.test($b.text()));
    cy.get("main", { timeout: 180000 }).should("contain.text", "pull").and("contain.text", "push");
    cy.get("main").should("not.contain.text", "needs attention");
  });
});
