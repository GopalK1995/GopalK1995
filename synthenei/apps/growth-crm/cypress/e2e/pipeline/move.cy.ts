// Real session: a stage move persists across reload and the stage-age row resets. Written, NOT run in light mode.
import { card, firstCardName, loginOrSkip, moveVia } from "./_helpers";

describe("pipeline: persisted move", () => {
  beforeEach(function () { loginOrSkip(this, "MANAGER"); });

  it("moves a card, survives a reload, and the card age restarts at 0d", () => {
    cy.visit("/pipeline");
    cy.get("[data-stage]", { timeout: 30000 }).should("have.length.at.least", 5);
    firstCardName("discovery").then((name) => {
      moveVia(name, /Proposal|Quote/);
      cy.contains(/moved to/i).should("be.visible");
      cy.reload();
      card(name).find("[data-testid=stage-age]").should("contain.text", "0d");
    });
  });
});
