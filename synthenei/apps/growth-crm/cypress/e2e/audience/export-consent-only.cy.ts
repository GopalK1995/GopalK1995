describe("audience: export includes only consented contacts", () => {
  it("demo: export button states the consented count and the rule", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/audience");
    cy.contains("leaves out contacts without marketing consent", { matchCase: false }).should("exist");
    cy.contains("button", /Export \d+ for platform upload/).should("exist");
  });
  it("viewer cannot export", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/audience");
    cy.contains("button", /Export/).should("be.disabled");
  });
  const email = Cypress.expose("OWNER_EMAIL") as string | undefined;
  const password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
  (email && password ? it : it.skip)("real: the consented count is shown apart from the total and the result reports who was left out", () => {
    cy.loginReal({ email: email!, password: password! });
    cy.visit("/audience");
    cy.contains("Consented for marketing").should("exist");
    cy.contains("button", /Export \d+ consented/).click();
    cy.contains("contacts without consent were left out").should("exist");
  });
});
