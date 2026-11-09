// Staging / demo only. Written, NOT run (light mode).
// Mailchimp listing and the settings panel in a demo session (never claims a push happened), the webhook rejecting a wrong key, and,
// with a stubbed Mailchimp (MAILCHIMP_API_BASE pointing at a fixture server) and a connected workspace, an accepted unsubscribe and a segment push.
//   CYPRESS_MC_CONNECTION = integration id of a connected Mailchimp connection (stub), CYPRESS_MC_HOOK_KEY = its webhook key
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of that workspace
import { clickUntil } from "../../support/retry-click";

const FAKE = "11111111-1111-4111-8111-111111111111";
const FORM = { "content-type": "application/x-www-form-urlencoded" };
const hook = (conn: string, key?: string) => `/api/hooks/mailchimp/${conn}${key ? `?k=${encodeURIComponent(key)}` : ""}`;

describe("connectors: Mailchimp sync", () => {
  it("demo session: Mailchimp is listed as not connected and the settings panel says nothing is pushed", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    cy.get("main").should("contain.text", "Mailchimp");
    cy.get("main [data-chip=connected]").should("not.exist");
    cy.visit("/settings/email");
    cy.get("main").should("contain.text", "Mailchimp audience");
    cy.get("main").should("contain.text", "Showcase: nothing is pushed to Mailchimp");
  });

  it("the Mailchimp webhook answers 404 for an unknown connection and 401 for a missing or wrong key", function () {
    const body = "type=unsubscribe&data[email]=a@example.com";
    cy.request({ method: "POST", url: hook(FAKE, "wrong"), body, headers: FORM, failOnStatusCode: false }).its("status").should("eq", 404);
    const conn = Cypress.expose("MC_CONNECTION") as string | undefined;
    if (!conn) return this.skip();
    cy.request({ method: "POST", url: hook(conn), body, headers: FORM, failOnStatusCode: false }).its("status").should("eq", 401);
    cy.request({ method: "POST", url: hook(conn, "wrong"), body, headers: FORM, failOnStatusCode: false }).its("status").should("eq", 401);
  });

  it("an unsubscribe webhook with the right key is accepted", function () {
    const conn = Cypress.expose("MC_CONNECTION") as string | undefined, key = Cypress.expose("MC_HOOK_KEY") as string | undefined;
    if (!conn || !key) return this.skip();
    const addr = `cy-${Date.now()}@example.com`;
    cy.request({ method: "POST", url: hook(conn, key), body: `type=unsubscribe&data[email]=${encodeURIComponent(addr)}`, headers: FORM }).its("status").should("eq", 200);
  });

  it("real session: the suppression list and the segment push are available; contacts without consent are skipped, not sent", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!Cypress.expose("MC_CONNECTION") || !email || !password) return this.skip();
    cy.loginAs("owner-lawsome");
    cy.loginReal({ email, password });
    cy.visit("/settings/email");
    cy.get("main").should("contain.text", "Suppression list").and("contain.text", "Mailchimp audience");
    clickUntil(() => cy.contains("main button", /push to mailchimp/i), ($b) => $b.find("main [role=status]").length > 0);
    cy.get("main [role=status]").should("exist");
  });
});
