// Staging / demo only. Written, NOT run (light mode).
// Part 1 (demo, no setup): /settings/email shows the Showcase sender identity and a domain that says Showcase, never "Verified".
// Part 2 (needs a sandbox email connection): connect with the documented sandbox key, save a sender identity, the domain panel stays
// honest, and the public Resend webhook rejects an unsigned or wrongly signed delivery.
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner of a workspace where the resend connector is available (sandbox)
//   CYPRESS_EMAIL_CONNECTION = integration id of that connection (for the webhook checks)
import { clickUntil } from "../../support/retry-click";

const FAKE = "11111111-1111-4111-8111-111111111111";

describe("connectors: email send (mock provider)", () => {
  it("demo session: the identity and domain panels carry the Showcase label and nothing claims a verified domain", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/email");
    cy.get("main [data-testid=email-settings]").should("be.visible");
    cy.get("main [data-testid=email-showcase]").should("contain.text", "Showcase");
    cy.get("main [data-domain-status=showcase]").should("exist");
    cy.get("main [data-domain-status=verified]").should("not.exist");
    cy.get("main").should("contain.text", "Suppression list");
  });

  it("demo session: saving the identity says nothing was saved", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/email");
    clickUntil(() => cy.contains("main button", /^save$/i), ($b) => /nothing was saved/i.test($b.find("main [role=status]").text()));
    cy.get("main [role=status]").should("contain.text", "nothing was saved");
  });

  it("a viewer cannot manage email settings", () => {
    cy.loginAs("viewer-lawsome");
    cy.visit("/settings/email", { failOnStatusCode: false });
    cy.get("main").should("not.contain.text", "Sender identity");
  });

  it("the Resend webhook refuses an unsigned delivery and an unknown connection", function () {
    const conn = Cypress.expose("EMAIL_CONNECTION") as string | undefined;
    const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_cy", to: ["bounce@example.com"], bounce: { type: "Permanent" } } });
    const json = { "content-type": "application/json" };
    cy.request({ method: "POST", url: `/api/hooks/resend/${FAKE}`, body, headers: json, failOnStatusCode: false }).its("status").should("eq", 404);
    if (!conn) return this.skip();
    cy.request({ method: "POST", url: `/api/hooks/resend/${conn}`, body, headers: json, failOnStatusCode: false }).its("status").should("eq", 401);
    cy.request({ method: "POST", url: `/api/hooks/resend/${conn}`, body, failOnStatusCode: false, headers: { ...json, "svix-id": "msg_cy", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,AAAA" } }).its("status").should("eq", 401);
  });

  it("real session: saves a sender identity, then the domain panel shows only what the sandbox can say", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!email || !password) return this.skip();
    cy.loginAs("owner-lawsome");
    cy.loginReal({ email, password });
    cy.visit("/integrations/resend");
    cy.get("main input[name=api_key]").type("re_mock_key", { log: false });
    clickUntil(() => cy.contains("main button", /connect/i), ($b) => $b.find("main [data-chip=sandbox], main [data-chip=connected]").length > 0);
    cy.visit("/settings/email");
    cy.get("main input[type=email]").first().clear().type("hello@cypress-sender.test");
    clickUntil(() => cy.contains("main button", /^save$/i), ($b) => /saved/i.test($b.find("main [role=status]").text()));
    clickUntil(() => cy.contains("main button", /check now/i), ($b) => $b.find("main [data-domain-status]").length > 0);
    cy.get("main [data-domain-status=verified]").should("not.exist");
    cy.get("main").should("not.contain.text", "re_mock_key");
  });
});
