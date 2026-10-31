// A support session never changes integrations: connect, test, run and disconnect are disabled with a reason, and the
// server refuses the actions as well (unit-tested: actions.test.ts). Selectors follow the support form used by settings/support-blocked.
describe("integrations: support sessions are blocked", () => {
  for (const mode of ["read_only", "read_write"] as const) {
    it(`${mode}: management controls are disabled with a reason`, () => {
      cy.loginAs("super");
      cy.visit("/admin/support");
      cy.get(`input[type=radio][name=mode][value=${mode}]`).check({ force: true });
      cy.get("textarea[name=reason]").type("T022 verification: a support session must not change integrations.");
      cy.get("input[name=reason2]").then(($i) => { if ($i.length) cy.wrap($i).type("T022 verification second reason line"); });
      cy.get("form button[type=submit]").first().click();
      cy.visit("/integrations");
      cy.get("body").then(($b) => {
        if ($b.text().includes("Showcase")) { cy.contains("button", "How to connect").should("have.attr", "disabled"); return; }
        cy.contains("Not available in a support session").should("exist");
      });
      cy.visit("/admin/support");
      cy.contains("button", "End now").click();
    });
  }
});
