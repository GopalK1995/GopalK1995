// Outbound webhooks: the test-event button. Written, NOT run in light mode.
import { addEndpointViaUi, echoUrl, loginOrSkip, requireMode, stamp } from "./_helpers";

describe("webhooks-out: test delivery", () => {
  it("demo: the test ping is simulated and makes no network request", function () {
    requireMode(this, "demo");
    cy.loginAs("owner-lawsome");
    cy.intercept("**", (req) => { if (/hooks\.example\.com/.test(req.url)) throw new Error("demo test ping must not call the endpoint"); });
    cy.visit("/settings/webhooks");
    cy.contains("tr", "hooks.example.com").contains("button", /send test event/i).click();
    cy.contains(/simulated test ping succeeded/i).should("be.visible");
  });

  it("real: a signed webhook.test event reaches the receiver and appears in the delivery log", function () {
    requireMode(this, "real");
    if (!echoUrl()) this.skip();
    loginOrSkip(this, "OWNER");
    const name = stamp();
    addEndpointViaUi({ url: echoUrl(), description: name });
    cy.contains("button", /I have saved it/).click();
    cy.contains("tr", name).contains("button", /send test event/i).click();
    cy.contains(/test event delivered \(2\d\d/i, { timeout: 15000 }).should("be.visible");
    cy.contains("tr", name).contains("a", /delivery log/i).click();
    cy.contains("tr", "webhook.test").within(() => {
      cy.contains(/delivered/i).should("be.visible");
      cy.contains(/\d+ ms/).should("be.visible");
    });
  });
});
