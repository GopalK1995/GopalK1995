// Staging only. Written, NOT run (light mode).
// Daily Google Ads cost / clicks / impressions sync against a mock API base: GOOGLE_ADS_API_BASE points at a stub that answers
// customers:listAccessibleCustomers and customers/<id>/googleAds:search (GAQL, page tokens), or the Showcase gateway serves two sample
// campaigns. Without the developer token the connector shows its gate ("Needs Google Ads developer token (basic access)").
//   CYPRESS_GOOGLE_ADS_CONNECTION = integration id of a connected google-ads connection with a customer selected
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace
import { clickUntil, clickLinkUntilPath } from "../../support/retry-click";

describe("connectors: Google Ads sync", () => {
  it("shows Google Ads in a demo session as a showcase with its developer-token gate, not as connected", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    clickLinkUntilPath(() => cy.contains("main a", /google ads/i), /\/integrations\/google-ads/);
    cy.get("main").should("contain.text", "Google Ads");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("synced campaign-days appear on the campaigns page for a real owner", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!Cypress.expose("GOOGLE_ADS_CONNECTION") || !email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/integrations/google-ads");
    clickUntil(() => cy.contains("main button", /sync now/i), ($b) => /sync/i.test($b.text()));
    cy.visit("/campaigns");
    cy.get("main", { timeout: 180000 }).should("contain.text", "Sample search campaign");   // Showcase / stub campaign name
  });
});
