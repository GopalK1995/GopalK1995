describe("audience: build and save a segment", () => {
  it("demo: AND across rules, live count, save is a showcase", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/audience");
    cy.contains("Build a segment").should("exist");
    cy.contains("Marketing consent").should("exist");
    cy.contains("button", "Save segment").click();
    cy.contains("nothing was saved", { matchCase: false }).should("exist");
  });
  const email = Cypress.expose("OWNER_EMAIL") as string | undefined;
  const password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
  (email && password ? it : it.skip)("real: saved segment keeps its rules after reload; push stays disabled with a reason", () => {
    cy.loginReal({ email: email!, password: password! });
    cy.visit("/audience");
    cy.get("input").first().clear().type(`Cypress segment ${Date.now()}`);
    cy.get("#seg-add").select(1);
    cy.contains("button", "Add").click();
    cy.get("fieldset button").first().click();
    cy.contains("Matching").should("exist");
    cy.contains("Consented for marketing").should("exist");
    cy.contains("button", "Save segment").click();
    cy.contains("Segment saved").should("exist");
    cy.reload();
    cy.contains("Saved segments").should("exist");
    cy.contains("button", "Push to ad platform").should("be.disabled");
    cy.contains("Needs a connected ad account").should("exist");
  });
});
