// Staging only (real Supabase): a user whose membership was removed is sent to /login?error=revoked once the 10-minute
// window has passed. Needs CYPRESS_REVOKED_EMAIL / CYPRESS_REVOKED_PASSWORD for a seeded user whose membership is inactive.
describe("tenancy: revoked membership", () => {
  const email = Cypress.expose("REVOKED_EMAIL") as string | undefined;
  const password = Cypress.expose("REVOKED_PASSWORD") as string | undefined;
  (email && password ? it : it.skip)("revoked user lands on /login?error=revoked", () => {
    cy.loginReal({ email: email!, password: password! });
    cy.visit("/", { failOnStatusCode: false });
    cy.location("search").should("contain", "error=revoked");
  });
});
