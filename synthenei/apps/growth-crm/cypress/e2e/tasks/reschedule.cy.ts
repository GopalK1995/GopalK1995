// Real session: snooze moves a task and survives reload; the week calendar moves a task with the keyboard.
// Written, NOT run in light mode.
import { createViaDialog, loginOrSkip, stamp, taskRow } from "./_helpers";

describe("tasks: reschedule", () => {
  beforeEach(function () { loginOrSkip(this, "REP"); });

  it("snooze to next Monday persists", () => {
    const a = stamp();
    cy.visit("/tasks");
    createViaDialog(a);
    taskRow(a).find("button[aria-label^='Snooze']").click();
    cy.contains("[role=menuitem]", /Next Monday/i).click();
    cy.contains(/Snoozed to/i).should("be.visible");
    cy.reload();
    taskRow(a).should("contain.text", "Mon");
  });

  it("calendar block moves a day with Alt+ArrowRight and the dialog is the keyboard alternative", () => {
    cy.visit("/tasks?tab=calendar");
    cy.contains("[role=tab]", /Week calendar/i).click();
    cy.get("button[aria-label*='Press Enter to reschedule']", { timeout: 30000 }).first().focus().type("{alt}{rightArrow}");
    cy.get("[role=status]").should("contain.text", "Moved");
    cy.get("button[aria-label*='Press Enter to reschedule']").first().focus().type("{enter}");
    cy.contains("[role=dialog]", /Reschedule/i).should("be.visible");
    cy.contains("button", /Cancel/i).click();
  });
});
