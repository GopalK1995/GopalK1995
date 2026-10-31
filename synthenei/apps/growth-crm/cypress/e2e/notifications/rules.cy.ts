import { loginOrSkip } from "../comments/_helpers";

describe("notification preferences and rules", () => {
  it("demo: saves quiet hours in IST", () => {
    cy.visit("/settings/notifications");
    cy.contains("h2", /Quiet hours \(IST\)/i).should("be.visible");
    cy.contains("button", /Save quiet hours/i).click();
    cy.contains(/Quiet hours saved/i).should("be.visible");
  });
  it("a rep sees the denied state for rules", function () {
    loginOrSkip(this, "REP");
    cy.visit("/settings/notifications");
    cy.contains(/Rules need the notifications.manage permission/i).should("be.visible");
  });
  it("owner adds a rule", function () {
    loginOrSkip(this, "OWNER");
    cy.visit("/settings/notifications");
    cy.contains("button", /Add rule/i).click();
    cy.get("[data-testid=rule]").first().contains("button", /^Save$/).click();
    cy.contains(/Rule saved/i).should("be.visible");
  });
});
