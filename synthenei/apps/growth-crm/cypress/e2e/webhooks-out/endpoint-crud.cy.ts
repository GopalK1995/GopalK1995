// Outbound webhooks: endpoint management. Written, NOT run in light mode.
import { addEndpointViaUi, echoUrl, loginOrSkip, requireMode, stamp } from "./_helpers";
import { clickLinkUntilPath } from "../../support/retry-click";

describe("webhooks-out: endpoint CRUD", () => {
  it("demo: shows a labelled sample list, saves nothing and can open the delivery log", function () {
    requireMode(this, "demo");
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/webhooks");
    cy.contains(/demo workspace/i).should("be.visible");
    cy.contains("hooks.example.com").should("be.visible");
    clickLinkUntilPath(() => cy.contains("tr", "hooks.example.com").contains("a", /delivery log/i), /\/settings\/webhooks\/demo-1$/);
    cy.contains(/delivery log for hooks\.example\.com/i).should("be.visible");
  });

  it("demo: adding an endpoint reports that nothing was saved and shows no secret", function () {
    requireMode(this, "demo");
    cy.loginAs("owner-lawsome");
    addEndpointViaUi({ url: "https://example.com/hook" });
    cy.contains(/nothing was saved/i).should("be.visible");
    cy.get("[data-testid=issued-secret]").should("not.exist");
  });

  it("denied: a viewer sees the permission-denied state", function () {
    requireMode(this, "demo");
    cy.loginAs("viewer-lawsome");
    // A viewer is stopped before the page renders (403 "cannot open settings"); a role that reaches the page without webhooks.manage sees the permission state.
    cy.visit("/settings/webhooks", { failOnStatusCode: false });
    cy.contains(/cannot open|cannot manage webhooks|does not have it/i).should("be.visible");
    cy.contains("button", /add endpoint/i).should("not.exist");
  });

  it("real: create shows the secret once, edit, pause, resume, rotate, delete", function () {
    requireMode(this, "real");
    if (!echoUrl()) this.skip();
    loginOrSkip(this, "OWNER");
    const name = stamp();
    addEndpointViaUi({ url: echoUrl(), description: name, events: ["lead.created", "deal.won"] });
    cy.get("[data-testid=issued-secret]").invoke("text").should("match", /^whsec_/).then((secret) => {
      cy.contains("button", /I have saved it/).click();
      cy.reload();
      cy.get("body").should("not.contain.text", secret.trim());
    });
    cy.contains("tr", name).within(() => {
      cy.contains(/2 event types/i).should("be.visible");
      cy.contains("button", /^Pause$/).click();
    });
    cy.get("[role=dialog]").contains("button", /pause endpoint/i).click();
    cy.contains("tr", name).contains(/paused/i).should("be.visible");
    cy.contains("tr", name).contains("button", /^Resume$/).click();
    cy.contains("tr", name).contains(/active/i).should("be.visible");
    cy.contains("tr", name).contains("button", /rotate secret/i).click();
    cy.get("[role=dialog]").contains("button", /rotate secret/i).click();
    cy.get("[data-testid=issued-secret]").invoke("text").should("match", /^whsec_/);
    cy.contains(/both secrets sign requests for 24 hours/i).should("be.visible");
    cy.contains("button", /I have saved it/).click();
    cy.contains("tr", name).contains("button", /^Delete$/).click();
    cy.get("[role=dialog]").contains("button", /delete endpoint/i).click();
    cy.contains("tr", name).should("not.exist");
  });

  it("real: a manager without webhooks.manage gets the denied state", function () {
    requireMode(this, "real");
    loginOrSkip(this, "VIEWER");
    cy.visit("/settings/webhooks");
    cy.contains(/cannot manage webhooks/i).should("be.visible");
  });
});
