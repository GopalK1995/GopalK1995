describe("leads: status and lost reason", () => {
  it("disqualify needs a reason", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/leads?view=all");
    cy.get("table tbody a").first().click();
    cy.contains("button", "Status").click();
    cy.contains("Disqualify").click();
    cy.get("select[name=reason]").should("have.attr", "required");
    cy.get("select[name=reason]").select(1);
    cy.contains("button", "Disqualify").click();
    cy.contains(/Status set to disqualified/).should("exist");
  });
});
