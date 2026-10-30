// Demo mode: the dialog validates and says what would happen (nothing persists). Real-mode persistence is covered on staging
// by setting CYPRESS_REAL_SUPER_EMAIL / CYPRESS_REAL_SUPER_PASSWORD (not required for the demo run).
describe("admin: create tenant", () => {
  beforeEach(() => { cy.loginAs("super"); cy.visit("/admin/tenants"); });
  it("rejects a bad slug inline, then accepts a complete form", () => {
    cy.contains("button", "Create tenant").click();
    cy.get("input[name=name]").type("Nilgiri Law Associates");
    cy.get("input[name=slug]").type("N!");
    cy.get("input[name=workspace]").type("Coimbatore");
    cy.get("input[name=owner]").type("owner@firm.example");
    cy.get("[role=dialog] button[type=submit]").click();
    cy.get("[role=dialog]").should("contain.text", "Slug");
    cy.get("input[name=slug]").clear().type("nilgiri-law");
    cy.get("[role=dialog] button[type=submit]").click();
    cy.contains("Would create tenant Nilgiri Law Associates").should("be.visible");
  });
  it("refuses a slug that already exists", () => {
    cy.contains("button", "Create tenant").click();
    cy.get("input[name=name]").type("Another LAWSOME");
    cy.get("input[name=slug]").type("lawsome");
    cy.get("input[name=workspace]").type("Chennai");
    cy.get("input[name=owner]").type("owner@firm.example");
    cy.get("[role=dialog] button[type=submit]").click();
    cy.get("[role=dialog]").should("contain.text", "already used");
  });
});
