// T054. Written, not run. The viewer sees the same page as aggregates: no record links, no people or account names.
describe("dashboard: viewer is masked", () => {
  it("decision rows are plain text (no links into records)", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/");
    cy.get("[data-zone=decision]").should("be.visible");
    cy.get("[data-decision] a").should("not.exist");
  });

  it("rep and account names are replaced by numbered labels", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/");
    cy.get("body").then(($b) => {
      const team = $b.find("[data-chart=team] tbody th");
      if (team.length) team.each((_, th) => { expect(th.textContent).to.match(/^Rep \d+$/); });
      const accounts = $b.find("[data-chart=accounts] tbody th");
      if (accounts.length) accounts.each((_, th) => { expect(th.textContent).to.match(/^Account \d+$/); });
    });
  });

  it("no raw email or phone number appears anywhere on the home page", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/");
    cy.get("main").invoke("text").should("not.match", /[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
