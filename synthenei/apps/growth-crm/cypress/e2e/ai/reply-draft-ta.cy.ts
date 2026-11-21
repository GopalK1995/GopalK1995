// Staging only, with AI_MOCK_PROVIDER=1 on the deployment (the deterministic mock answers; no vendor key, no cost). Written, NOT run.
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = owner of a real workspace that has at least one conversation with an inbound message
describe("ai: reply draft in Tamil (mock provider)", () => {
  beforeEach(function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!email || !password) return this.skip();
    cy.loginReal({ email, password });
  });

  it("the Owner turns Reply draft on after the three data checks", () => {
    cy.visit("/ai");
    cy.get("main [role=switch][aria-label^='Reply draft'], main [role=switch][aria-label^='Reply drafts']").first().then(($s) => {
      if ($s.attr("aria-checked") === "true") return;
      cy.wrap($s).click();
      cy.get("[role=dialog] input[type=checkbox]").each(($c) => cy.wrap($c).check());
      cy.get("[role=dialog] button").contains(/^turn on$/i).click();
    });
    cy.get("main [role=switch][aria-checked=true]").should("exist");
  });

  it("drafts in Tamil, flags it for translation review, and Use draft fills the reply box without sending", () => {
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.get("[data-cy=reply-draft]").should("be.visible");
    cy.get("[data-cy=draft-lang-ta]").click();
    cy.get("[data-cy=draft-generate]").click();
    cy.get("[data-cy=draft-body]", { timeout: 30000 }).should("contain.text", "[mock-ta]");
    cy.get("[data-cy=draft-result]").should("contain.text", "Check translation");
    cy.get("[data-cy=draft-use]").click();
    cy.get("textarea").first().invoke("val").should("contain", "[mock-ta]");
    cy.get("[data-cy=draft-result]").should("not.exist");
  });

  it("drafts in English with the same path", () => {
    cy.visit("/inbox");
    cy.get("[data-cy=conversation-row]").first().click();
    cy.get("[data-cy=draft-lang-en]").click();
    cy.get("[data-cy=draft-generate]").click();
    cy.get("[data-cy=draft-body]", { timeout: 30000 }).should("contain.text", "[mock-en]");
    cy.get("[data-cy=draft-result]").should("not.contain.text", "Check translation");
  });
});
