// Logging a restore drill on /data-health (src/app/(app)/data-health/_components/{actions,controls}.tsx logRestoreDrill).
// Demo sessions never write (src/lib/data/backup.ts mockBackupAdapter ships a single static drill log entry); this spec
// proves the form validates and the demo path is a safe no-op. A real, persisting drill is unit-tested instead
// (src/lib/backups/__tests__/adapter.test.ts parseDrillDetail, and evaluate.ts's drillPassAt plumbing).
describe("data-health: restore drill", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); cy.visit("/data-health"); });

  it("demo: logging a drill shows the demo notice and never adds a row to the log", () => {
    cy.get("[aria-label='Restore drill log']").find("li").its("length").then((before) => {
      cy.contains("button", "Log restore drill").click();
      cy.get("[role=dialog]").should("contain.text", "Log restore drill");
      cy.get("[role=dialog] textarea").type("Cypress: restored latest dump, counts matched.");
      cy.get("[role=dialog]").contains("button", "Save to drill log").click();
      cy.contains("Restore drill recorded as pass").should("be.visible");
      cy.contains("Demo workspace: nothing is saved.").should("be.visible");
      cy.get("[role=dialog]").should("not.exist"); // closes on success
      cy.get("[aria-label='Restore drill log']").find("li").should("have.length", before);
    });
  });

  it("demo: a failed outcome is reported with its own message", () => {
    cy.contains("button", "Log restore drill").click();
    // The outcome Select is a Radix combobox; its option list portals to <body>, outside [role=dialog].
    cy.get("[role=dialog] [role=combobox]").click();
    cy.contains("[role=option]", "Failed: needs follow-up").click();
    cy.get("[role=dialog]").contains("button", "Save to drill log").click();
    cy.contains("Restore drill recorded as fail").should("be.visible");
  });

  it("validates minutes: out of range disables save with an inline error", () => {
    cy.contains("button", "Log restore drill").click();
    cy.get("[role=dialog] input[inputmode=numeric]").clear().type("2000");
    cy.get("[role=dialog]").contains("Whole minutes, 0 to 1440").should("be.visible");
    cy.get("[role=dialog]").contains("button", "Save to drill log").should("be.disabled");
    cy.get("[role=dialog] input[inputmode=numeric]").clear().type("45");
    cy.get("[role=dialog]").contains("button", "Save to drill log").should("not.be.disabled");
  });

  it("cancelling the dialog closes it without recording anything", () => {
    cy.get("[aria-label='Restore drill log']").find("li").its("length").then((before) => {
      cy.contains("button", "Log restore drill").click();
      cy.get("[role=dialog] textarea").type("this should not be saved");
      cy.get("[role=dialog]").contains("button", "Cancel").click();
      cy.get("[role=dialog]").should("not.exist");
      cy.contains("Restore drill recorded").should("not.exist");
      cy.get("[aria-label='Restore drill log']").find("li").should("have.length", before);
    });
  });
});
