// Starting a subscription is Razorpay Subscriptions in test mode until the owner's own account goes live (src/lib/billing/config.ts
// razorpayConfig, src/lib/billing/service.ts startSubscription). Demo sessions never call Razorpay at all
// (src/app/(app)/settings/billing/actions.ts subscribe() short-circuits before startSubscription): this spec proves that, and
// exercises the real plan -> checkout UI path on the shared demo store. The actual Razorpay round trip needs test keys on the
// server and a real owner session, so that part runs on staging only: RAZORPAY_KEY_ID/_SECRET (test mode) plus
// CYPRESS_QA_OWNER_EMAIL/_PASSWORD (see cypress/e2e/settings/_helpers.ts).
import { creds } from "../settings/_helpers";

describe("billing: subscribing (demo is a safe no-op)", () => {
  const planId = "cy-test-pro";
  after(() => {
    // Leave the plan catalogue clean for later specs: hide the test plan rather than delete it (BillingStore has no delete).
    cy.loginAs("super");
    cy.visit("/admin/billing");
    cy.get(`[data-testid=plan-${planId}]`).within(() => { cy.get("input[name=isPublic]").uncheck(); cy.contains("button", "Save plan").click(); });
  });

  it("demo: the platform admin publishes a priced plan and the owner's subscribe click never reaches Razorpay", () => {
    cy.loginAs("super");
    cy.visit("/admin/billing");
    cy.get("[data-testid=plan-new]").within(() => {
      cy.get("input[name=id]").type(planId);
      cy.get("input[name=name]").type("Cypress Pro");
      cy.get("input[name=monthly]").clear().type("999.00");
      cy.get("input[name=yearly]").clear().type("9999.00");
      cy.get("input[name=limits]").type("seats=10");
      cy.get("input[name=isPublic]").check();
      cy.contains("button", "Add plan").click();
    });
    cy.contains("Plan saved.").should("be.visible");

    cy.loginAs("owner-lawsome");
    cy.visit("/settings/billing");
    cy.get(`[data-testid=plan-${planId}]`).contains("button", "Subscribe monthly").click();
    cy.contains("Subscription created. Continue to Razorpay to authorise the payment.").should("be.visible");
    cy.contains("Demo: nothing was saved or sent.").should("be.visible");
    cy.contains("Continue to Razorpay").should("not.exist"); // demo never gets a real checkout url back
  });

  it("demo: with no Razorpay keys configured, the mode badge says payment is not set up", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/billing");
    cy.get("[data-testid=billing-plan]").contains("Online payment not set up").should("be.visible");
  });

  const owner = creds("OWNER");
  const real = !!owner.email && !!owner.password && !!Cypress.expose("RAZORPAY_TEST_KEY_ID_SET");
  (real ? it : it.skip)("real, test-mode Razorpay configured: subscribing returns a Razorpay checkout url", () => {
    cy.loginReal({ email: owner.email!, password: owner.password! });
    cy.visit("/settings/billing");
    cy.get("[data-testid=billing-plan]").contains("Razorpay test mode").should("be.visible");
    cy.contains("li[data-testid^='plan-']", "Subscribe monthly").first().contains("button", "Subscribe monthly").click();
    cy.contains("Continue to Razorpay").should("have.attr", "href").and("match", /razorpay\.com|rzp\.io/);
  });
});
