// Alert rules on /data-health (src/lib/backups/rules.ts evaluates them; src/app/(app)/data-health/_components/actions.ts
// wires the UI). The demo workspace's mock snapshot (src/lib/data/backup.ts mockBackupAdapter) always ships 4 persisted
// rules, so the "no rules yet / Create default rules" path (snap.rulesPersisted === false) has no demo lever — it only
// happens for a brand-new real workspace before its first hourly job run, so that case is unit-tested instead
// (src/lib/backups/__tests__/evaluate.test.ts loadWorkspaceHealth "createdDefaults" case).
describe("data-health: alert rules", () => {
  beforeEach(() => { cy.loginAs("owner-lawsome"); cy.visit("/data-health"); });

  it("demo: lists the 4 sample rules with their real states and does not show a firing banner", () => {
    cy.contains("li", "Backup is stale").should("contain.text", "OK");
    cy.contains("li", "Row-count drop").should("contain.text", "OK");
    cy.contains("li", "Restore drill overdue").should("contain.text", "OK");
    cy.contains("li", "Sync failed twice").should("contain.text", "Paused");
    cy.get("[data-testid=firing-banner]").should("not.exist");
    cy.get("[data-testid=no-rules]").should("not.exist");
  });

  it("demo: toggling a rule flips the switch and shows the demo notice, without a real save", () => {
    cy.contains("li", "Sync failed twice").find('button[role=switch]').as("toggle");
    cy.get("@toggle").should("have.attr", "aria-checked", "false");
    cy.get("@toggle").click();
    cy.contains("Alert rule enabled").should("be.visible");
    cy.contains("Demo workspace: nothing is saved.").should("be.visible");
    cy.get("@toggle").should("have.attr", "aria-checked", "true");
    // A reload proves nothing was actually persisted: the demo mock always starts "Sync failed twice" paused.
    cy.reload();
    cy.contains("li", "Sync failed twice").find('button[role=switch]').should("have.attr", "aria-checked", "false");
  });

  it("demo: Run check reports no findings and never fires on sample data", () => {
    cy.contains("button", "Run check").click();
    cy.contains("Check passed on sample values").should("be.visible");
    cy.contains("Demo workspace: nothing is saved.").should("be.visible");
  });
});
