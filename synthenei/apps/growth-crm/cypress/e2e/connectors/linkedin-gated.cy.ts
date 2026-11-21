// Staging only. Written, NOT run (light mode).
// LinkedIn has no public sandbox and the connector stays gated (needs_vendor_approval) until LinkedIn grants the Advertising API and
// Lead Sync products. Part 1 (no setup): in a demo session the card shows as a showcase with its approval gate, never as connected.
// Part 2 (needs a sandbox LinkedIn connection with an ad account selected, LINKEDIN_API_BASE pointing at a stub that answers
//   /rest/adAccounts, /rest/leadFormResponses and /rest/adAnalytics, or the Showcase gateway's sample lead and sample campaign):
//   a manual sync brings the sample lead and the sample campaign-days in for a real owner.
//   CYPRESS_LINKEDIN_CONNECTION = integration id of a connected (sandbox) linkedin connection with an ad account selected
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace
import { clickUntil } from "../../support/retry-click";

describe("connectors: LinkedIn (gated)", () => {
  it("lists LinkedIn in a demo session as a showcase with its approval gate, not as connected", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    clickUntil(() => cy.contains("main a", /linkedin/i), ($b) => /\/integrations\/linkedin/.test($b[0].ownerDocument.location.pathname));
    cy.get("main").should("contain.text", "LinkedIn");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("synced sample leads and campaign-days appear for a real owner", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!Cypress.expose("LINKEDIN_CONNECTION") || !email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/integrations/linkedin");
    clickUntil(() => cy.contains("main button", /sync now/i), ($b) => /sync/i.test($b.text()));
    cy.visit("/leads");
    cy.get("main", { timeout: 180000 }).should("contain.text", "Sample Lead");
    cy.visit("/campaigns");
    cy.get("main", { timeout: 180000 }).should("contain.text", "Sample campaign");
  });
});
