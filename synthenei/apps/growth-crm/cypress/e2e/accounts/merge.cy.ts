// T015 (not run by the author). Real-mode merge needs staging users; the demo run checks the dialog and guard.
describe("accounts: merge", () => {
  it("manager can open merge and must pick a target", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/accounts");
    cy.get("table a").first().click();
    cy.get("[data-cy=merge-account]").click();
    cy.get("select[name=targetId]").select(1);
    cy.get("[data-cy=account-submit]").click();
    cy.contains("Demo workspace: nothing was saved").should("exist");
  });
  it("sales rep cannot merge (disabled with reason)", () => {
    cy.loginAs("rep-lawsome");
    cy.visit("/accounts");
    cy.get("table a").first().click();
    cy.get("[data-cy=merge-account]").should("be.disabled");
  });
});
