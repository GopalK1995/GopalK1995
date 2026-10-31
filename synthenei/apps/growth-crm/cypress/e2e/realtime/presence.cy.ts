// Two sessions see each other. Session A is the browser (MANAGER); session B joins the same topic headlessly through the
// cy.task "presencePeer" (a realtime-js client that tracks {userId,name,initials,color,at}). That task is NOT part of this change
// (docs/tasks/T026.md, Needs from integrator), so the spec is skipped unless CYPRESS_QA_HAS_PRESENCE_TASK=1. Written, NOT run.
import { loginOrSkip } from "./_helpers";

describe("realtime: presence", () => {
  beforeEach(function () {
    if (!Cypress.expose("QA_HAS_PRESENCE_TASK")) this.skip();
    loginOrSkip(this, "MANAGER");
  });

  it("shows a colleague's face on the board and removes it when they leave", () => {
    cy.visit("/pipeline");
    cy.task("presencePeer", { who: "REP", scope: "board", action: "join" });
    cy.get("[data-testid=presence-faces]", { timeout: 15000 }).should("have.attr", "data-count", "1");
    cy.get("[data-testid=presence-face]").should("have.length", 1);
    cy.task("presencePeer", { who: "REP", scope: "board", action: "leave" });
    cy.get("[data-testid=presence-faces]", { timeout: 15000 }).should("not.exist");
  });

  it("the sync chip reads Live while connected", () => {
    cy.visit("/pipeline");
    cy.get("[data-testid=sync-chip]", { timeout: 15000 }).should("have.attr", "data-state", "live");
  });
});
