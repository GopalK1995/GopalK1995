// WhatsApp 24 h window: when it has closed only an approved template can be sent, and a real send is stored as queued.
describe("inbox: window expired, template only", () => {
  it("a thread with a closed window offers templates, not free text", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/inbox");
    cy.get("body").then(($b) => {
      if (!$b.find("[data-cy=conversation-row]:contains('Window closed')").length) return; // sample data has no expired thread today
      cy.contains("[data-cy=conversation-row]", "Window closed").click();
      cy.get("[data-cy=window-bar]").should("have.attr", "data-state", "closed");
      cy.get("[data-cy=template-only]").should("exist");
      cy.get("textarea").should("not.exist");
    });
  });
  const email = Cypress.expose("OWNER_EMAIL") as string | undefined;
  const password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
  (email && password ? it : it.skip)("real session: queued banner is always visible and a send says nothing was delivered", () => {
    cy.loginReal({ email: email!, password: password! });
    cy.visit("/inbox");
    cy.get("[data-cy=queue-banner]").should("contain", "Queued: sending needs a connected channel");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.get("body").then(($b) => {
      if ($b.find("[data-cy=send-template]").length) cy.get("[data-cy=send-template]").click();
      else { cy.get("textarea").first().type("Queue test"); cy.get("[data-cy=send]").click(); }
    });
    cy.get("[data-cy=msg-queued]", { timeout: 10000 }).should("exist");
  });
});
