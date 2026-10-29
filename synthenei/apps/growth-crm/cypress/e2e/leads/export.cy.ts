describe("leads: export", () => {
  it("owner export downloads a CSV", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/leads?view=all");
    cy.get("table tbody input[type=checkbox]").first().check();
    cy.contains("button", /Export/).click();
    cy.contains(/Exported \d+ leads/).should("exist");
  });
  it("viewer cannot export (control absent or disabled)", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/leads");
    cy.contains("button", /Export/).should("not.exist");
  });
});
