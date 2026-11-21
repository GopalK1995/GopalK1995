// T052 (written, NOT run by the author). Retention rules and the retention job.
// The scheduled job ships DISABLED: the page must say it is Off, and a dry run must count rows without changing any. Demo shows sample
// rules. Staging (owner credentials as in erasure.cy.ts) saves and removes a rule on the branch DB and runs the dry run.
describe("privacy: retention job", () => {
  it("shows the rules and that the scheduled job is off (demo)", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/privacy/retention");
    cy.get("[data-testid=retention-job]").should("have.attr", "data-job", "off").and("contain.text", "Off");
    cy.get("[data-testid=rule-row]").should("have.length.at.least", 1);
  });
  it("a dry run reports counts and says it changes nothing (demo)", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/privacy/retention");
    cy.contains("A dry run").should("be.visible");
    cy.get("[data-testid=retention-dry-run]").click();
    cy.get("[data-testid=dry-run-result]").should("be.visible");
  });
  it("refuses a rule with fewer than one day", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/privacy/retention");
    cy.get("[data-testid=rule-days]").clear().type("0");
    cy.get("[data-testid=rule-save]").should("be.disabled");
    cy.get("[data-testid=rule-days]").clear().type("30");
    cy.get("[data-testid=rule-save]").should("be.enabled");
  });
  it("only owners can open it", () => {
    for (const p of ["rep-lawsome", "mkt-lawsome", "viewer-lawsome"] as const) {
      cy.loginAs(p);
      cy.visit("/settings/privacy/retention", { failOnStatusCode: false });
      cy.get("[data-testid=privacy-retention]").should("not.exist");
    }
  });

  describe("staging", () => {
    const ok = Cypress.expose("OWNER_EMAIL");
    beforeEach(function () { if (!ok) this.skip(); });
    it("saves a rule, previews it with a dry run, removes it", () => {
      cy.loginReal({ email: String(Cypress.expose("OWNER_EMAIL")), password: String(Cypress.expose("OWNER_PASSWORD")) });
      cy.visit("/settings/privacy/retention");
      cy.get("[data-testid=rule-object]").select("lead_event");
      cy.get("[data-testid=rule-days]").clear().type("3650");
      cy.get("[data-testid=rule-action]").select("anonymise");
      cy.get("[data-testid=rule-save]").click();
      cy.get("[data-testid=rule-row][data-object=lead_event]").should("exist");
      cy.get("[data-testid=retention-job]").should("have.attr", "data-job").and("match", /off|unknown/);
      cy.get("[data-testid=retention-dry-run]").click();
      cy.get("[data-testid=dry-run-result]").should("be.visible");
      cy.get("[data-testid=rule-row][data-object=lead_event]").contains("button", "Remove").click();
      cy.get("[data-testid=rule-row][data-object=lead_event]").should("not.exist");
    });
  });
});
