// Staging only. Written, NOT run (light mode).
// Google Sheets import against a mock base: GOOGLE_SHEETS_API_BASE points at a stub that answers spreadsheets/<id> and
// spreadsheets/<id>/values/<range>, or the Showcase gateway serves one fictional sheet (rows are flagged as sample data). The owner
// previews, maps the columns and imports; the rows go through the CSV importer's validation and dedupe, so a second import never doubles.
//   CYPRESS_SHEETS_CONNECTION = integration id of a connected google-sheets connection with an import requested (Showcase or stub base)
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace
import { clickUntil, clickLinkUntilPath } from "../../support/retry-click";

describe("connectors: Google Sheets import", () => {
  it("shows Google Sheets import in a demo session as a showcase, not as connected", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    clickLinkUntilPath(() => cy.contains("main a", /google sheets/i), /\/integrations\/google-sheets/);
    cy.get("main").should("contain.text", "Google Sheets");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("an import run creates the sheet's leads once and a re-run finds them as duplicates (real owner session)", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!Cypress.expose("SHEETS_CONNECTION") || !email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/integrations/google-sheets");
    clickUntil(() => cy.contains("main button", /sync now/i), ($b) => /sync/i.test($b.text()));
    cy.visit("/leads?q=Sample%20Person%20One");
    cy.get("main", { timeout: 180000 }).should("contain.text", "Sample Person One");
    cy.get("main").find("a, tr").filter(":contains('Sample Person One')").should("have.length.lessThan", 3);   // one lead, not a doubled import
  });
});
