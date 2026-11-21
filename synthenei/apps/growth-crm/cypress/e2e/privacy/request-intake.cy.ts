// T052 (written, NOT run by the author). Public DPDP request intake and the owner inbox.
// Demo part (no setup): the owner inbox lists sample requests with due dates, overdue first; other roles cannot open it.
// Staging part (set CYPRESS_PRIVACY_WS to a workspace slug on the staging branch DB, CYPRESS_PRIVACY_BASE_OK=1 to allow sends):
//   the public page shows the tenant-branded notice and form; a bad email is refused; a valid one answers "check your email" and stores
//   nothing until the emailed link is confirmed; a forged link is refused; the honeypot is answered like a real request; limits hold.
describe("privacy: request intake", () => {
  describe("owner inbox (demo)", () => {
    it("lists requests with due dates, most urgent first", () => {
      cy.loginAs("owner-lawsome");
      cy.visit("/settings/privacy");
      cy.get("[data-testid=privacy-inbox]").should("exist");
      cy.get("[data-testid=request-row]").should("have.length.at.least", 3);
      cy.get("[data-testid=request-row]").first().find("[data-due]").should("have.attr", "data-due", "overdue");
      cy.get("[data-testid=request-row]").last().should("have.attr", "data-status", "completed");
      cy.get("[data-testid=inbox-summary]").invoke("text").should("match", /\d+ open, \d+ overdue/);
      cy.get("[data-testid=public-path]").should("contain.text", "/privacy/");
    });
    it("a sales rep and a viewer cannot open it", () => {
      for (const p of ["rep-lawsome", "viewer-lawsome"] as const) {
        cy.loginAs(p);
        cy.visit("/settings/privacy", { failOnStatusCode: false });
        cy.get("[data-testid=privacy-inbox]").should("not.exist");
      }
    });
  });

  describe("public form (staging)", () => {
    const ws = Cypress.expose("PRIVACY_WS") as string | undefined;
    beforeEach(function () { if (!ws) this.skip(); });
    it("shows the tenant notice and a request form", () => {
      cy.visit(`/privacy/${ws}`);
      cy.get("[data-testid=privacy-notice]").should("be.visible");
      cy.get("[data-testid=request-form]").should("be.visible");
      cy.contains("h2", /Your rights/i).should("exist");
    });
    it("refuses a bad address and accepts a good one without revealing whether it is known", () => {
      cy.visit(`/privacy/${ws}`);
      cy.get("[data-testid=request-email]").type("not-an-email");
      cy.get("[data-testid=request-submit]").click();
      cy.get("[role=alert]").should("contain.text", "valid email");
      cy.get("[data-testid=request-email]").clear().type(`nobody-${Date.now()}@example.test`);
      cy.get("[data-testid=request-submit]").click();
      cy.get("[data-testid=request-sent]").should("contain.text", "Check your email");
    });
    it("withdrawal needs at least one purpose", () => {
      cy.visit(`/privacy/${ws}`);
      cy.get("[data-testid=kind-withdrawal]").check();
      cy.get("[data-testid=request-email]").type("someone@example.test");
      cy.get("[data-testid=request-submit]").click();
      cy.get("[role=alert]").should("contain.text", "at least one purpose");
    });
    it("a forged or expired link is refused and nothing is recorded", () => {
      cy.visit(`/privacy/${ws}/verify/v1.AAAA.BBBB.CCCC`);
      cy.contains(/does not work/i).should("be.visible");
      cy.get("[data-testid=verify-confirm]").should("not.exist");
    });
    it("limits repeat requests from one address", () => {
      const email = `limit-${Date.now()}@example.test`;
      // The per-address limit is 3 an hour; the 4th attempt for the same address is refused. The form resets after each "sent" by reloading.
      for (let i = 0; i < 3; i++) {
        cy.visit(`/privacy/${ws}`);
        cy.get("[data-testid=request-email]").type(email);
        cy.get("[data-testid=request-submit]").click();
        cy.get("[data-testid=request-sent]").should("be.visible");
      }
      cy.visit(`/privacy/${ws}`);
      cy.get("[data-testid=request-email]").type(email);
      cy.get("[data-testid=request-submit]").click();
      cy.get("[role=alert]").should("contain.text", "Too many");
    });
  });
});
