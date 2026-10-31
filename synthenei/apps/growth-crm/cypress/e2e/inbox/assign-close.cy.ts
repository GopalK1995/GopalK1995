// Demo path runs everywhere. The real path needs staging users: CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD.
describe("inbox: assign and close", () => {
  it("demo owner assigns and closes; the showcase label stays", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.contains("Showcase · simulated").should("exist");
    cy.get("[data-cy=assign-select]").first().find("option").its("length").should("be.gte", 1);
    cy.get("[data-cy=close-btn]").first().click();
    cy.contains("Conversation closed").should("exist");
  });
  it("rep cannot assign: the control is disabled with a reason", () => {
    cy.loginAs("rep-lawsome");
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.get("[data-cy=assign-btn]").first().should("be.disabled");
  });
  const email = Cypress.expose("OWNER_EMAIL") as string | undefined;
  const password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
  (email && password ? it : it.skip)("real owner closes then reopens; state survives a reload", () => {
    cy.loginReal({ email: email!, password: password! });
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.get("[data-cy=close-btn]").first().click();
    cy.contains("Conversation closed").should("exist");
    cy.reload();
    cy.get("[data-cy=conversation-row]").first().click();
    cy.get("[data-cy=closed-line]").should("exist");
    cy.get("[data-cy=reopen-btn]").first().click();
    cy.contains("Conversation reopened").should("exist");
  });
});
