// A support session (read_only or read_write) never manages people, roles or teams: the page shows the reason and
// offers no control. The server refuses the actions as well (unit-tested). Selectors follow src/app/admin/_components/support-form.tsx;
// T018 replaces that form, adjust then. Written, NOT run in light mode.
describe("settings: support sessions are blocked", () => {
  for (const mode of ["read_only", "read_write"] as const) {
    it(`${mode}: users, roles and teams are not manageable`, () => {
      cy.loginAs("super");
      cy.visit("/admin/support");
      // Type the reason first: the "ok" counter only appears once React has hydrated, so the radio change below is not lost.
      cy.get("textarea[name=reason]").type("T017 verification: a support session must not manage people.");
      cy.contains("ok").should("exist");
      cy.get(`input[type=radio][name=mode][value=${mode}]`).check();
      // The second reason only exists in read_write mode.
      if (mode === "read_write") cy.get("input[name=reason2]").type("T017 verification second reason line");
      else cy.get("input[name=reason2]").should("not.exist");
      cy.get("form button[type=submit]").first().click();
      cy.location("pathname").should("eq", "/");
      cy.visit("/settings/roles", { failOnStatusCode: false });
      // read_only acts as Viewer, which cannot open settings at all (403 page); read_write reaches the page and gets the support reason.
      if (mode === "read_only") cy.contains(/cannot open/i).should("be.visible");
      else cy.contains(/Support sessions cannot manage users, roles or teams/i).should("be.visible");
      cy.contains("button", /^Invite$/).should("not.exist");
    });
  }
});
