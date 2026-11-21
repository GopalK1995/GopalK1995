// Staging only (AI_MOCK_PROVIDER=1), written, NOT run. Reply draft must already be switched on (see reply-draft-ta.cy.ts).
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = owner of a real workspace with a conversation
describe("ai: usage caps", () => {
  beforeEach(function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!email || !password) return this.skip();
    cy.loginReal({ email, password });
  });

  it("a monthly cap of zero blocks the next draft with a plain message and nothing is sent to a model", () => {
    cy.visit("/ai");
    cy.get("[data-cy=cap-calls]").clear().type("0");
    cy.contains("[data-cy=ai-settings] button", /save limits/i).click();
    cy.contains("[role=status], [data-sonner-toast]", /saved/i).should("exist");
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.get("[data-cy=draft-generate]").click();
    cy.get("[data-cy=draft-note]", { timeout: 30000 }).should("contain.text", "limit");
    cy.get("[data-cy=draft-result]").should("not.exist");
  });

  it("removing the cap lets drafts through again", () => {
    cy.visit("/ai");
    cy.get("[data-cy=cap-calls]").clear();
    cy.contains("[data-cy=ai-settings] button", /save limits/i).click();
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.get("[data-cy=draft-generate]").click();
    cy.get("[data-cy=draft-body]", { timeout: 30000 }).should("exist");
  });

  it("there is no public API that reaches a model, so a cap cannot be bypassed from outside the app", () => {
    for (const url of ["/api/ai", "/api/v1/ai", "/api/v1/ai/complete", "/api/ai/complete"]) {
      cy.request({ url, method: "POST", body: { prompt: "hi", model: "claude-opus-5-5" }, failOnStatusCode: false }).its("status").should("be.oneOf", [401, 403, 404, 405]);
    }
  });
});
