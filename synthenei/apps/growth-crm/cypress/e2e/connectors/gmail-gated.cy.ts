// Staging only. Written, NOT run (light mode).
// Gmail is gated: it uses a restricted Google scope, so it is open only while the platform's Google OAuth app is in testing mode (or after
// CASA) and only after the tenant opts in. In a demo session the page must show the gate and no connect that bypasses it.
//   CYPRESS_GMAIL_CONNECTION = (optional) id of a Gmail connection made in testing mode
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace
import { clickLinkUntilPath } from "../../support/retry-click";

describe("connectors: Gmail is gated", () => {
  it("shows Gmail as gated (not connected) in a demo session, with the testing-mode explanation", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    clickLinkUntilPath(() => cy.contains("main a", /gmail/i), /\/integrations\/gmail/);
    cy.get("main").should("contain.text", "Gmail");
    cy.get("main [data-chip=connected]").should("not.exist");
    cy.get("main").invoke("text").should("match", /test user|testing|not available|vendor approval|opt in/i);
  });

  it("a real owner cannot connect Gmail without the opt-in acknowledgements (no restricted scope is requested)", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/integrations/gmail");
    cy.get("main").should("not.contain.text", "connected");
    cy.get("main a[href*='/api/oauth/gmail/start']").should("not.exist");
  });
});
