// T015 (not run by the author).
describe("accounts: viewer masking", () => {
  it("viewer does not see contact names or phone numbers on a firm page", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/accounts");
    cy.get("table a").first().click();
    cy.contains("not shown to Viewers").should("exist");
    cy.get("[data-cy=contact-row]").should("not.exist");
  });
  it("viewer cannot export", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/accounts");
    cy.get("[data-cy=export-accounts]").should("be.disabled");
  });
});
