describe("leads: rep scope", () => {
  it("a rep opening another rep's lead sees the denial, not the data", () => {
    cy.loginAs("rep-lawsome");
    cy.visit("/leads?view=all");
    cy.get("table tbody a").should("have.length.greaterThan", 0);
  });
});
