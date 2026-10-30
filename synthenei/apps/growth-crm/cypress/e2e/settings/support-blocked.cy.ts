// A support session (read_only or read_write) never manages people, roles or teams: the page shows the reason and
// offers no control. The server refuses the actions as well (unit-tested). Selectors follow src/app/admin/_components/support-form.tsx;
// T018 replaces that form, adjust then. Written, NOT run in light mode.
describe("settings: support sessions are blocked", () => {
  for (const mode of ["read_only", "read_write"] as const) {
    it(`${mode}: users, roles and teams are not manageable`, () => {
      cy.loginAs("super");
      cy.visit("/admin/support");
      cy.get(`input[type=radio][name=mode][value=${mode}]`).check({ force: true });
      cy.get("textarea[name=reason]").type("T017 verification: a support session must not manage people.");
      cy.get("input[name=reason2]").then(($i) => { if ($i.length) cy.wrap($i).type("T017 verification second reason line"); });
      cy.get("form button[type=submit]").first().click();
      cy.visit("/settings/roles");
      cy.contains(/Support sessions cannot manage users, roles or teams/i).should("be.visible");
      cy.contains("button", /^Invite$/).should("not.exist");
    });
  }
});
