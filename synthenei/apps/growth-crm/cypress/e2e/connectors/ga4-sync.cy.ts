// Staging only. Written, NOT run (light mode).
// Daily GA4 report sync against a mock API base: the server runs with GA4_DATA_API_BASE / GA4_ADMIN_API_BASE pointing at a stub that
// answers accountSummaries and properties/<id>:runReport, or with the Showcase gateway (sample sessions, labelled). The scheduled stream
// runs hourly from 05:30 IST and loads the backfill, then the trailing days; this spec runs it with "Run sync now" and reads the log.
//   CYPRESS_GA4_CONNECTION = integration id of a connected ga4 connection with a property selected (sandbox / Showcase or stub base)
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace
import { clickUntil, clickLinkUntilPath } from "../../support/retry-click";

describe("connectors: GA4 sync", () => {
  it("lists Google Analytics 4 in a demo session as a showcase, not as connected", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    clickLinkUntilPath(() => cy.contains("main a", /google analytics/i), /\/integrations\/ga4/);
    cy.get("main").should("contain.text", "Google Analytics 4");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("a sync run loads the daily report and the sync log shows it (real owner session, stub or Showcase base)", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!Cypress.expose("GA4_CONNECTION") || !email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/integrations/ga4");
    clickUntil(() => cy.contains("main button", /sync now/i), ($b) => /sync/i.test($b.text()));
    cy.get("main", { timeout: 180000 }).should("contain.text", "daily");
    cy.get("main").should("not.contain.text", "needs attention");
  });
});
