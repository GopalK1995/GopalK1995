import { loginOrSkip, requireMode } from "../api/_helpers";
// Real mode: an XLSX of accounts goes through storage and the import queue.
// Needs the binary fixture cypress/fixtures/import/accounts.xlsx (columns: Company, City, Website).
describe("import: accounts XLSX", () => {
  it("uploads, imports and lists the job in history", function () {
    requireMode(this, "real");
    loginOrSkip(this, "OWNER");
    cy.visit("/import");
    cy.get("main").find("[data-testid=import-object]").select("account");
    cy.get("main").find("[data-testid=import-file]").selectFile("cypress/fixtures/import/accounts.xlsx");
    cy.get("main").find("[data-testid=import-continue]", { timeout: 20000 }).should("be.enabled").click();
    cy.get("main").find("[data-testid=import-start]", { timeout: 20000 }).click();
    cy.get("main").find("[data-testid=import-result]", { timeout: 90000 }).should("contain.text", "Import finished");
    cy.get("main").find("[data-testid=import-history]").should("exist");
  });
});
