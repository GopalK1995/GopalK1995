// Demo mode: Nithya (marketing) belongs to two tenants; the switcher lists exactly her workspaces and switching sticks.
describe("tenancy: switch workspace", () => {
  it("lists her three workspaces and switches to Kaveri", () => {
    cy.loginAs("mkt-lawsome");
    cy.visit("/");
    cy.get('[data-testid="ws-switcher"]').click();
    cy.get("[data-ws]").should("have.length", 3);
    cy.get('[data-ws="kaveri-cbe"]').click();
    cy.get('[data-testid="ws-switcher"]', { timeout: 30000 }).should("contain.text", "Coimbatore");
  });
});
