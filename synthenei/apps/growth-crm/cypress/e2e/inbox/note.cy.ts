// Internal notes: team only, never sent to the contact. Real path: CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD.
describe("inbox: internal note", () => {
  it("demo owner adds a note and is told it is not sent", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.contains("button", "Internal note").click();
    cy.get("textarea").first().type("Call back after lunch");
    cy.contains("button", "Add note").click();
    cy.contains("Internal note added").should("exist");
    cy.get("[data-cy=internal-note]").should("contain", "Call back after lunch");
  });
  it("viewer cannot write a note", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.contains("button", "Add note").should("not.exist");
  });
  const email = Cypress.expose("OWNER_EMAIL") as string | undefined;
  const password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
  (email && password ? it : it.skip)("real note persists after reload and is labelled not sent", () => {
    cy.loginReal({ email: email!, password: password! });
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.contains("button", "Internal note").click();
    cy.get("textarea").first().type("Note from the T028 spec");
    cy.contains("button", "Add note").click();
    cy.reload();
    cy.get("[data-cy=conversation-row]").first().click();
    cy.get("[data-cy=internal-note]").should("contain", "Note from the T028 spec").and("contain", "not sent");
  });
});
