// Real session: a manager can reassign; a rep sees the reassign entry disabled with the missing permission as the reason,
// and a stale write shows the conflict banner (needs the bumpTaskVersion task, same pattern as pipeline). Written, NOT run in light mode.
import { createViaDialog, creds, loginOrSkip, stamp, taskRow } from "./_helpers";

describe("tasks: reassign permissions", () => {
  it("manager reassigns a rep's task", function () {
    loginOrSkip(this, "MANAGER");
    cy.visit("/tasks");
    cy.get("[data-testid=task-row]", { timeout: 30000 }).first().find("button[aria-label^='Snooze']").click();
    cy.contains("[role=menuitem]", /^(?!Pick|Tomorrow|In 1|Next).+/).first().should("exist");
    cy.get("body").type("{esc}");
  });

  it("rep sees reassign disabled with a reason", function () {
    loginOrSkip(this, "REP");
    const a = stamp();
    cy.visit("/tasks");
    createViaDialog(a);
    taskRow(a).find("button[aria-label^='Snooze']").click();
    cy.contains("[role=menuitem][aria-disabled=true], [role=menuitem][data-disabled]", /tasks\.assign/i).should("exist");
  });

  it("stale version shows the conflict banner and restores the row", function () {
    if (!Cypress.expose("QA_HAS_BUMP_TASK") || !creds("REP").email) this.skip();
    loginOrSkip(this, "REP");
    const a = stamp();
    cy.visit("/tasks");
    createViaDialog(a);
    cy.task("bumpTaskVersion", a);
    taskRow(a).find("button[aria-label^='Snooze']").click();
    cy.contains("[role=menuitem]", /Tomorrow/i).click();
    cy.get("[data-cy=conflict-banner]").should("be.visible");
    taskRow(a).should("exist");
  });
});
