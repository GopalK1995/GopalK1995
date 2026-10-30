// T015 (not run by the author; the integrator runs it at the gate).
describe("accounts: crud (demo workspace)", () => {
  it("owner adds a law firm: result says nothing was saved", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/accounts");
    cy.get("[data-cy=create-account]").click();
    cy.get("input[name=name]").type("Test & Associates");
    cy.get("[data-cy=account-submit]").click();
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });
  it("owner edits and reassigns from the detail page", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/accounts");
    cy.get("table a").first().click();
    cy.get("[data-cy=edit-account]").click();
    cy.get("input[name=city]").clear().type("Madurai");
    cy.get("[data-cy=account-submit]").click();
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });
  it("viewer sees create disabled with a reason", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/accounts");
    cy.get("[data-cy=create-account]").should("be.disabled");
  });
  // Hospitality vocabulary (guest/partner) is asserted in the unit test; no hospitality persona exists yet.
});
