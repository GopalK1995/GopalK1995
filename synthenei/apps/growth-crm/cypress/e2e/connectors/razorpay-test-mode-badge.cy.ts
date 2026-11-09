// Staging only. Written, NOT run (light mode).
// The mode label on the Razorpay connection: Showcase (mock gateway) in a demo session, "Test mode" for rzp_test_ keys, never "Live"
// for either. Connecting uses the documented showcase key so no real keys and no network are involved.
//   CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD = an owner in a workspace where the razorpay connector is available (sandbox)
import { clickUntil } from "../../support/retry-click";

describe("connectors: Razorpay test-mode badge", () => {
  it("demo session: Razorpay is listed and nothing claims to be live", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/integrations");
    cy.get("main").should("contain.text", "Razorpay");
    cy.get("main [data-payment-mode=live]").should("not.exist");
  });

  it("connect with the showcase key: badge says Showcase, no secret in the page", function () {
    const email = Cypress.expose("OWNER_EMAIL") as string | undefined, password = Cypress.expose("OWNER_PASSWORD") as string | undefined;
    if (!email || !password) return this.skip();
    cy.loginAs("owner-lawsome");
    cy.loginReal({ email, password });
    cy.visit("/integrations/razorpay");
    cy.get("main input[name=key_id]").type("rzp_test_mockshowcase");
    cy.get("main input[name=key_secret]").type("rzp-mock-secret", { log: false });
    cy.get("main input[name=webhook_secret]").type("whsec-cypress", { log: false });
    clickUntil(() => cy.contains("main button", /connect/i), ($b) => $b.find("main [data-payment-mode]").length > 0);
    cy.get("main [data-payment-mode=showcase]").should("be.visible");
    cy.get("main [data-payment-mode=live]").should("not.exist");
    cy.get("main").should("not.contain.text", "rzp-mock-secret").and("not.contain.text", "whsec-cypress");
  });
});
