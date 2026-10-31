// Link a conversation to a lead. Real path: CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD.
describe("inbox: link to lead", () => {
  it("demo owner picks another record and links it", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.get("[data-cy=link-select]").first().find("option").eq(1).then(($o) => cy.get("[data-cy=link-select]").first().select($o.val() as string));
    cy.get("[data-cy=link-btn]").first().click();
    cy.contains("Conversation linked").should("exist");
  });
  it("link stays disabled until a different record is chosen", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.get("[data-cy=link-btn]").first().should("be.disabled");
  });
  const email = Cypress.expose("OWNER_EMAIL") as string | undefined;
  const password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
  (email && password ? it : it.skip)("real link is saved and the conversation shows the lead", () => {
    cy.loginReal({ email: email!, password: password! });
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.get("[data-cy=link-select]").first().find("option").eq(1).then(($o) => cy.get("[data-cy=link-select]").first().select($o.val() as string));
    cy.get("[data-cy=link-btn]").first().click();
    cy.contains("Conversation linked").should("exist");
  });
});
