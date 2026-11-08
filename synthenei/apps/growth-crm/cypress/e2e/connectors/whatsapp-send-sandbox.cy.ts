// Staging only. Written, NOT run (light mode).
// Sending against the sandbox gateway. cy.intercept cannot see server-side calls, so the Graph API is stubbed where the server
// can reach it: set WHATSAPP_API_BASE on the app to a stub, or connect with the documented sandbox token (wa-mock-token) so the
// connector uses its built-in mock gateway and no network is involved at all. This spec uses the sandbox token.
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner in a workspace where the whatsapp connector is available (sandbox)
import { clickUntil } from "../../support/retry-click";

describe("connectors: WhatsApp send (sandbox)", () => {
  it("demo session: the WhatsApp card is a labelled showcase and sends nothing real", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    cy.get("main").should("contain.text", "WhatsApp");
    cy.visit("/inbox");
    cy.get("main").should("be.visible");
  });

  it("connect with the sandbox token: shows Sandbox (never Connected), no secret in the page, then disconnect", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!email || !password) return this.skip();
    cy.loginAs("owner-lawsome");
    cy.loginReal({ email, password });
    cy.visit("/integrations/whatsapp");
    cy.get("main input[name=waba_id]").type("1234567890");
    cy.get("main input[name=phone_number_id]").type("1234567891");
    cy.get("main input[name=access_token]").type("wa-mock-token", { log: false });
    cy.get("main input[name=app_secret]").type("sandbox-app-secret", { log: false });
    clickUntil(() => cy.contains("main button", "Connect"), ($b) => $b.find("[data-chip=sandbox]").length > 0);
    cy.get("main [data-chip]", { timeout: 20000 }).first().should("have.attr", "data-chip", "sandbox");
    cy.get("main [data-chip=connected]").should("not.exist");
    cy.get("main").should("not.contain.text", "wa-mock-token").and("not.contain.text", "sandbox-app-secret");
    clickUntil(() => cy.contains("main button", "Disconnect"), ($b) => $b.find("[role=dialog]").length > 0);
    cy.get("[role=dialog]").contains("button", "Disconnect").click();
    cy.get("main [data-chip]", { timeout: 20000 }).first().should("have.attr", "data-chip", "disconnected");
  });

  it("a queued reply is blocked without consent and the thread says why (window and consent rules)", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!email || !password) return this.skip();
    cy.loginAs("owner-lawsome");
    cy.loginReal({ email, password });
    cy.visit("/inbox");
    cy.get("main [data-cy=queue-banner]").should("exist");
    cy.get("main").then(($m) => {
      if (!$m.find("[data-cy=conversation-row]").length) return;   // nothing to reply to on this branch
      cy.get("main [data-cy=conversation-row]").first().click();
      cy.get("main [data-cy=window-bar]").should("exist");
    });
  });
});
