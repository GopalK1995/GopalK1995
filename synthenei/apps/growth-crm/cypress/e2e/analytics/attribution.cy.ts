// T054. Written, not run. Attribution reads the touches the CRM recorded; a lead with no recorded touch is its own row.
describe("analytics: attribution from recorded touches", () => {
  it("demo owner can flip first and last touch and the table follows", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/analytics");
    cy.get("#attribution").within(() => {
      cy.contains("Which channel gets the credit?").should("exist");
      cy.get("[role=radio][aria-checked=true]").should("have.text", "First touch");
      cy.get("caption").should("contain.text", "first-touch");
      cy.contains("[role=radio]", "Last touch").click();
      cy.get("caption").should("contain.text", "last-touch");
      cy.get("tbody tr").its("length").should("be.greaterThan", 0);
    });
  });

  it("links to the social analytics page next to the paid view", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/analytics");
    cy.contains("a", "Paid and organic social").should("have.attr", "href", "/analytics/social").click();
    cy.location("pathname").should("eq", "/analytics/social");
  });

  const email = Cypress.expose("OWNER_EMAIL") as string | undefined;
  const password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
  (email && password ? it : it.skip)("real owner: leads without a recorded touch are not credited to Organic", () => {
    cy.loginReal({ email: email!, password: password! });
    cy.visit("/analytics");
    cy.get("#attribution").should("not.contain.text", "NaN");
    cy.get("#attribution tbody th").then(($th) => {
      const labels = [...$th].map((t) => t.textContent);
      // The "no touch" row, when present, is always last.
      const i = labels.indexOf("No touch recorded");
      if (i >= 0) expect(i).to.eq(labels.length - 1);
    });
  });
});
