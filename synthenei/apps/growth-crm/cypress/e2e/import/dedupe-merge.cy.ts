import { loginOrSkip, requireMode } from "../api/_helpers";
import { clickUntil } from "../../support/retry-click";

describe("import: duplicates", () => {
  it("finds duplicates and offers skip or merge", function () {
    requireMode(this, "demo");
    cy.loginAs("owner-lawsome");
    cy.visit("/import");
    cy.get("main").find("[data-testid=import-file]").selectFile("cypress/fixtures/import/dupes.csv");
    cy.get("main").find("[data-testid=import-continue]", { timeout: 15000 }).should("be.enabled");
    clickUntil(() => cy.get("main").find("[data-testid=import-continue]"), ($b) => $b.find("[data-testid=import-stat-dup]").length > 0);
    cy.get("main").find("[data-testid=import-stat-dup]").should("not.have.text", "0");
    cy.get("main").find("[data-testid=import-mode-merge]").check();
    cy.get("main").find("[data-testid=import-mode-skip]").should("not.be.checked");
  });
});
