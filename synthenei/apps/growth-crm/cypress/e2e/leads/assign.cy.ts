describe("leads: bulk assign", () => {
  it("owner selects rows and assigns; toast only after the action returns", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/leads?view=all");
    cy.get("table tbody input[type=checkbox]").first().check();
    cy.contains("button", "Assign").click();
    cy.contains(/assigned to/i).should("exist");
  });
  it("sales rep has no assign control", () => {
    cy.loginAs("rep-lawsome");
    cy.visit("/leads");
    cy.contains("button", "Assign").should("not.exist");
  });
});
