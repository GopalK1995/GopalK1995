// Real session on staging (needs CYPRESS_STAGING_OWNER_EMAIL and CYPRESS_STAGING_OWNER_PASSWORD and a seeded workspace). Written, NOT run in light mode.
// Each page renders real rows for the owner and never a synthetic row; a fresh workspace shows empty states.
const email = Cypress.expose("STAGING_OWNER_EMAIL") as string | undefined;
const password = Cypress.expose("STAGING_OWNER_PASSWORD") as string | undefined;
const pages = ["/inbox", "/integrations", "/analytics", "/tasks", "/settings", "/data-health"];

describe("data: real reads", () => {
  before(function () {
    if (!email || !password) this.skip();
  });
  beforeEach(() => {
    cy.loginReal({ email: email!, password: password! });
  });

  for (const path of pages) {
    it(`${path} renders without the synthetic data banner or an error state`, () => {
      cy.visit(path);
      cy.get("main", { timeout: 30000 }).should("be.visible");
      cy.contains(/Not connected yet/i).should("not.exist");
      cy.get('[data-testid="page-error"]').should("not.exist");
    });
  }

  it("fresh workspace shows empty states, not sample rows", function () {
    const fresh = Cypress.expose("STAGING_EMPTY_WS") as string | undefined;
    if (!fresh) this.skip();
    cy.visit("/inbox");
    cy.get('[data-testid="empty-state"]', { timeout: 30000 }).should("exist");
  });
});
