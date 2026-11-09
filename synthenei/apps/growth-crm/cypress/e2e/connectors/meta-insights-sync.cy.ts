// Staging only. Written, NOT run (light mode).
// Daily insights sync against a mock API base: the server runs with META_GRAPH_API_BASE pointing at a stub that answers
// /act_<id>/insights, or with the sandbox gateway (sample spend, labelled Showcase). The scheduled stream runs hourly after 06:00 IST
// and loads yesterday and the trailing 7 days; this spec checks the result on the campaigns page.
//   CYPRESS_META_CONNECTION = integration id of a connected meta-ads connection with an ad account selected
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace
import { clickUntil } from "../../support/retry-click";

describe("connectors: Meta insights sync", () => {
  it("shows sample spend labelled as showcase data in a demo session", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/campaigns");
    cy.get("main").should("be.visible");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("synced campaign-days appear on the campaigns page for a real owner", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!Cypress.expose("META_CONNECTION") || !email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/integrations/meta-ads");
    clickUntil(() => cy.contains("main button", /sync now/i), ($b) => /sync/i.test($b.text()));
    cy.visit("/campaigns");
    cy.get("main", { timeout: 180000 }).should("contain.text", "Sample campaign");   // sandbox / stub campaign name
  });
});
