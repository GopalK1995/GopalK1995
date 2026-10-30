// Real session: create a task, it survives a reload, then bulk-complete it. Written, NOT run in light mode.
import { createViaDialog, loginOrSkip, stamp, taskRow } from "./_helpers";

describe("tasks: create and complete", () => {
  beforeEach(function () { loginOrSkip(this, "REP"); });

  it("creates two tasks, they persist, and bulk complete removes both", () => {
    const a = stamp(), b = `${stamp()} b`;
    cy.visit("/tasks");
    createViaDialog(a);
    createViaDialog(b);
    cy.reload();
    taskRow(a).should("be.visible");
    taskRow(b).should("be.visible");
    taskRow(a).find("input[type=checkbox]").check();
    taskRow(b).find("input[type=checkbox]").check();
    cy.contains("button", /Complete 2/i).click();
    cy.contains(/2 tasks marked done/i).should("be.visible");
    cy.reload();
    cy.contains("[data-testid=task-row]", a).should("not.exist");
    cy.contains("[data-testid=task-row]", b).should("not.exist");
  });
});
