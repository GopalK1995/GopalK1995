import { loginOrSkip, requireMode } from "../api/_helpers";
describe("export: masks and support block", () => {
  it("owner exports a list and is told whether personal data is masked", function () {
    requireMode(this, "demo");
    cy.loginAs("owner-lawsome");
    cy.visit("/import");
    cy.get("main").find("[data-testid=export-mask]").check();
    cy.get("main").find("[data-testid=export-run]").click();
    cy.get("main").find("[data-testid=export-result]", { timeout: 15000 }).should("contain.text", "masked");
  });
  it("a viewer has no export", function () {
    requireMode(this, "demo");
    cy.loginAs("viewer-lawsome");
    cy.visit("/import");
    cy.get("main").find("[data-testid=export-run]").should("not.exist");
  });
});
