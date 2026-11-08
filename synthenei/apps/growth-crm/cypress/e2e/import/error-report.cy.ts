import { loginOrSkip, requireMode } from "../api/_helpers";
// Real mode: rows with problems are listed in the report after the import.
describe("import: error report", () => {
  it("offers the problem rows as a download", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    cy.visit("/import");
    cy.get("main").find("[data-testid=import-file]").selectFile("cypress/fixtures/import/leads.csv");
    cy.get("main").find("[data-testid=import-continue]", { timeout: 20000 }).should("be.enabled").click();
    cy.get("main").find("[data-testid=import-stat-invalid]", { timeout: 20000 }).should("have.text", "1");
    cy.get("main").find("[data-testid=import-start]").click();
    cy.get("main").find("[data-testid=import-download-errors]", { timeout: 90000 }).should("exist");
  });
});
