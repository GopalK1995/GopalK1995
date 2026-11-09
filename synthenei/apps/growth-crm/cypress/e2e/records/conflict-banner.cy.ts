// T040 (written by the author, NOT run). Stale custom-field edits are refused with a conflict banner and a Reload action (version
// guard in saveCustomValues). Needs a real staging session and the task that bumps a record version out of band (as leads/conflict.cy.ts).
describe("records: custom field conflict", () => {
  const email = Cypress.expose("REP_EMAIL") as string | undefined;
  const password = Cypress.expose("REP_PASSWORD") as string | undefined;
  (email && password ? it : it.skip)("a stale save shows the conflict banner and keeps the other person's value", () => {
    cy.loginReal({ email: email!, password: password! });
    cy.visit("/leads");
    cy.get("main table tbody a").first().click();
    cy.get("main [data-testid=custom-fields]").contains("button", "Edit").click();
    cy.task("bumpLeadVersion", { baseUrl: Cypress.config("baseUrl") });
    cy.get("main [data-testid=custom-fields] input[type=text], main [data-testid=custom-fields] input:not([type])").first().clear().type("Stale edit");
    cy.get("main [data-testid=custom-fields]").contains("button", "Save").click();
    cy.get("main [data-testid=custom-fields]").contains(/changed|conflict/i).should("exist");
    cy.get("main [data-testid=custom-fields]").contains("button", "Reload").should("exist");
  });
});
