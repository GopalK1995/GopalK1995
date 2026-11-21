// Staging only. Written, NOT run (light mode).
// Outlook / Microsoft 365 stays gated (needs_vendor_approval) until Microsoft verifies the app publisher. Part 1 (no setup): in a demo
// session the card shows as a showcase with its approval gate, never as connected. Part 2 (needs a sandbox Outlook connection and, for the
// live path, MICROSOFT_GRAPH_API_BASE pointing at a stub that answers /me, /me/mailFolders/*/messages/delta, /me/calendarView/delta and
// /subscriptions; the Showcase gateway answers the same shapes): a manual sync brings the sample calendar event in for a real owner.
//   CYPRESS_OUTLOOK_CONNECTION = integration id of a connected (sandbox) outlook connection
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace
import { clickUntil } from "../../support/retry-click";

describe("connectors: Outlook / Microsoft 365 (gated)", () => {
  it("lists Outlook in a demo session as a showcase with its approval gate, not as connected", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    clickUntil(() => cy.contains("main a", /outlook/i), ($b) => /\/integrations\/outlook/.test($b[0].ownerDocument.location.pathname));
    cy.get("main").should("contain.text", "Outlook");
    cy.get("main [data-chip=connected]").should("not.exist");
  });

  it("a manual sync brings the sample calendar event in for a real owner", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!Cypress.expose("OUTLOOK_CONNECTION") || !email || !password) return this.skip();
    cy.loginReal({ email, password });
    cy.visit("/integrations/outlook");
    clickUntil(() => cy.contains("main button", /sync now/i), ($b) => /sync/i.test($b.text()));
    cy.visit("/calendar");
    cy.get("main", { timeout: 180000 }).should("contain.text", "Sample: discovery call");
  });
});
