import { loginOrSkip } from "../comments/_helpers";

describe("notifications centre and bell", () => {
  it("demo: shows notifications, unread count, and marks all read", () => {
    cy.visit("/notifications");
    cy.get("[data-testid=notification]").should("have.length.at.least", 1);
    cy.get("[data-testid=unread-count]").should("be.visible");
    cy.contains("button", /Mark all read/i).click();
    cy.get("[data-testid=notification][data-unread=true]").should("not.exist");
  });
  it("real session: the centre loads", function () {
    loginOrSkip(this, "REP");
    cy.visit("/notifications");
    cy.get("[data-testid=unread-summary]").should("exist");
  });
});
