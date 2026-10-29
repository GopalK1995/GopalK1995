// Real session: the board holds a stale card version, someone else changes the deal, the move returns a conflict,
// the card rolls back and the banner appears. Needs a Cypress task bumpDealVersion(dealName) that updates the deal
// row (or moves it) as another user; that task is not part of this change (see docs/tasks/T014.md, Needs from integrator).
// Skipped unless CYPRESS_QA_HAS_BUMP_TASK=1. Written, NOT run in light mode.
import { firstCardName, loginOrSkip, moveVia } from "./_helpers";

describe("pipeline: conflict", () => {
  beforeEach(function () {
    if (!Cypress.expose("QA_HAS_BUMP_TASK")) this.skip();
    loginOrSkip(this, "MANAGER");
  });

  it("a stale move shows the changed-while-you-worked banner and restores the card", () => {
    cy.visit("/pipeline");
    firstCardName("discovery").then((name) => {
      cy.task("bumpDealVersion", name);
      moveVia(name, /Proposal|Quote/);
      cy.get("[data-testid=move-conflict]").should("be.visible");
      cy.get("[data-stage='discovery']").should("contain.text", name);
      cy.contains("button", /Review current board/i).click();
      cy.get("[data-testid=move-conflict]").should("not.exist");
    });
  });
});
