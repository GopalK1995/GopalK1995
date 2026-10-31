// Demo mode: Nithya (marketing) belongs to two tenants; the switcher lists exactly her workspaces and switching sticks.
describe("tenancy: switch workspace", () => {
  it("lists her three workspaces and switches to Kaveri", () => {
    cy.loginAs("mkt-lawsome");
    cy.visit("/");
    // The shell renders a switcher for the mobile bar and one for the sidebar; use the visible one.
    cy.get('[data-testid="ws-switcher"]:visible').first().click();
    cy.get("[data-ws]").should("have.length", 3);
    cy.get('[data-ws="kaveri-cbe"]').click();
    cy.get('[data-testid="ws-switcher"]:visible', { timeout: 30000 }).first().should("contain.text", "Coimbatore");
  });
});
