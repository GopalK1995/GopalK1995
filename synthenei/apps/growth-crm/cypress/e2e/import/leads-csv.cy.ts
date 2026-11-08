import { loginOrSkip, requireMode } from "../api/_helpers";
import { clickUntil } from "../../support/retry-click";

// Demo mode: the wizard runs on a CSV file and saves nothing.
describe("import: leads CSV", () => {
  it("maps columns, previews and reports a demo result", function () {
    requireMode(this, "demo");
    cy.loginAs("owner-lawsome");
    cy.visit("/import");
    cy.get("main").find("[data-testid=import-file]").selectFile("cypress/fixtures/import/leads.csv");
    cy.get("main").find("[data-testid=import-continue]", { timeout: 15000 }).should("be.enabled");
    clickUntil(() => cy.get("main").find("[data-testid=import-continue]"), ($b) => $b.find("[data-testid=import-stat-new]").length > 0);
    cy.get("main").find("[data-testid=import-stat-new]").should("have.text", "2");
    cy.get("main").find("[data-testid=import-stat-invalid]").should("have.text", "1");
    clickUntil(() => cy.get("main").find("[data-testid=import-start]"), ($b) => $b.find("[data-testid=import-result]").length > 0);
    cy.get("main").find("[data-testid=import-result]").should("contain.text", "nothing was saved");
  });
  it("a viewer cannot import", function () {
    requireMode(this, "demo");
    cy.loginAs("viewer-lawsome");
    cy.visit("/import");
    cy.get("main").find("[data-testid=import-file]").should("not.exist");
  });
});
