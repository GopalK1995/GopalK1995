describe("activity feed", () => {
  it("demo: workspace feed lists activity", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/notifications?tab=activity");
    cy.get("[data-testid=activity-feed] li").should("have.length.at.least", 1);
  });
});
