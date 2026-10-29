// Real session: a rep (own scope) sees only their own deals, and a viewer sees the board read-only with a stated reason.
// Written, NOT run in light mode. The server-side refusal of a colleague's deal is covered by unit tests (actions.test.ts).
import { creds, loginOrSkip } from "./_helpers";

describe("pipeline: scope and permission", () => {
  it("rep: board lists only own deals", function () {
    loginOrSkip(this, "REP");
    cy.visit("/pipeline");
    cy.get("[data-stage]", { timeout: 30000 }).should("exist");
    cy.get("body").should("not.contain.text", creds("REP2").email ?? "qa-rep2@synthan.test");
    cy.contains("Owner").should("not.exist"); // reps get no owner filter
  });

  it("viewer: cannot move, and the disabled control says why", function () {
    loginOrSkip(this, "VIEWER");
    cy.visit("/pipeline");
    cy.get("[data-testid=pipeline-readonly]", { timeout: 30000 }).should("be.visible");
    cy.get("button[aria-label^='Move'][aria-disabled=true]").first().focus();
    cy.get("[data-disabled-reason=true]").should("exist");
  });
});
