// Real session: Won captures plan, seats, value and start date; Lost captures a reason; both persist. Written, NOT run in light mode.
import { firstCardName, loginOrSkip, moveVia } from "./_helpers";

describe("pipeline: won and lost", () => {
  beforeEach(function () { loginOrSkip(this, "MANAGER"); });

  it("Won uses the capture form and the card is in Won after a reload", () => {
    cy.visit("/pipeline");
    firstCardName("negotiation").then((name) => {
      moveVia(name, /^Won/);
      cy.get("input[name=seats]").clear().type("5");
      cy.get("input[name=value]").clear().type("120000");
      cy.get("[role=dialog] form").submit();
      cy.reload();
      cy.get("[data-stage='won']").should("contain.text", name);
    });
  });

  it("Lost saves once a reason is picked", () => {
    cy.visit("/pipeline");
    firstCardName("proposal").then((name) => {
      moveVia(name, /^Lost/);
      cy.get("input[name=reason]").first().check({ force: true });
      cy.get("[role=dialog] form").submit();
      cy.reload();
      cy.get("[data-stage='lost']").should("contain.text", name);
    });
  });
});
