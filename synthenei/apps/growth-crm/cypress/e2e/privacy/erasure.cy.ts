// T052 (written, NOT run by the author). Erasure: owner only, confirmed by name, step report, never in a support session.
// Demo: the dialog, the owner gate and the sample result. Staging (CYPRESS_PRIVACY_ERASURE_REQUEST = id of an open erasure request linked to
// a throwaway lead; owner credentials in CYPRESS_OWNER_EMAIL / CYPRESS_OWNER_PASSWORD): erase runs erase_lead, then the extension steps, and
// the request closes with a note that lists what is left for a human. Run it only on the staging branch DB.
describe("privacy: erasure", () => {
  it("owner confirms by name before anything runs (demo)", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/privacy/demo-req-1");
    cy.get("[data-testid=erase-open]").should("be.enabled").click();
    cy.contains("Erase").should("be.visible");
    cy.contains("cannot be undone").should("be.visible");
    cy.contains("button", "Cancel").click();
    cy.get("[data-testid=erasure-report]").should("not.exist");
  });
  it("confirming in a sample workspace saves nothing and says so", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/privacy/demo-req-1");
    cy.get("[data-testid=erase-open]").click();
    cy.get("[data-testid=erase-confirm]").click();
    cy.contains(/nothing was saved/i).should("be.visible");
    cy.visit("/settings/privacy");
    cy.get("[data-testid=request-row][data-kind=erasure]").should("have.attr", "data-status", "in_progress");
  });
  it("a request with no linked record offers to link one", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/privacy/demo-req-3");
    cy.get("[data-testid=link-lead-id]").should("exist");
  });
  it("non-owners cannot reach the request page", () => {
    for (const p of ["rep-lawsome", "mkt-lawsome", "viewer-lawsome"] as const) {
      cy.loginAs(p);
      cy.visit("/settings/privacy/demo-req-1", { failOnStatusCode: false });
      cy.get("[data-testid=privacy-request]").should("not.exist");
    }
  });

  describe("staging", () => {
    const req = Cypress.expose("PRIVACY_ERASURE_REQUEST") as string | undefined;
    beforeEach(function () { if (!req) this.skip(); });
    it("runs erase_lead and the extension, closes the request and reports each step", () => {
      cy.loginReal({ email: String(Cypress.expose("OWNER_EMAIL")), password: String(Cypress.expose("OWNER_PASSWORD")) });
      cy.visit(`/settings/privacy/${req}`);
      cy.get("[data-testid=erase-open]").click();
      cy.get("[data-testid=erase-confirm]").click();
      cy.get("[data-testid=erasure-report]", { timeout: 30000 }).should("be.visible");
      cy.get("[data-step=erase_lead]").should("have.attr", "data-status", "done");
      cy.get("[data-step=suppression_list]").should("have.attr", "data-status", "kept");
      cy.reload();
      cy.get("[data-testid=request-notes]").should("contain.text", "Erasure:");
      cy.get("[data-testid=erase-open]").should("not.exist");
    });
  });
});
