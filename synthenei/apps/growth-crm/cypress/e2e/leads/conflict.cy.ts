// Needs staging users: CYPRESS_REP_EMAIL / CYPRESS_REP_PASSWORD (same user, two sessions simulated with a direct version bump).
describe("leads: 409 conflict", () => {
  const email = Cypress.expose("REP_EMAIL") as string | undefined;
  const password = Cypress.expose("REP_PASSWORD") as string | undefined;
  (email && password ? it : it.skip)("stale edit shows the conflict banner and saves nothing", () => {
    cy.loginReal({ email: email!, password: password! });
    cy.visit("/leads");
    cy.get("table tbody a").first().click();
    cy.get("[data-cy=edit-lead]").click();
    // Second session: a task (to be provided in cypress.config.ts by the integrator) bumps the lead version out of band.
    cy.task("bumpLeadVersion", { baseUrl: Cypress.config("baseUrl") });
    cy.get("input[name=city]").clear().type("Conflicted City");
    cy.contains("button", "Save changes").click();
    cy.get("[data-cy=conflict-banner]").should("exist");
  });
});
