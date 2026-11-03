// Demo mode: Nithya (marketing) belongs to two tenants; the switcher lists exactly her workspaces and switching sticks.
describe("tenancy: switch workspace", () => {
  it("lists her three workspaces and switches to Kaveri", () => {
    cy.loginAs("mkt-lawsome");
    cy.visit("/campaigns");
    // The shell renders a switcher for the mobile bar and one for the sidebar; use the visible one.
    // A click that lands before hydration is a no-op, so retry until the menu reports open.
    const open = (tries: number): void => {
      cy.get('[data-testid="ws-switcher"]:visible').first().click().then(() => {
        cy.wait(400).then(() => {
          if (Cypress.$("[data-ws]").length === 0 && tries > 0) open(tries - 1);
        });
      });
    };
    open(5);
    cy.get("[data-ws]").should("have.length", 3);
    cy.get('[data-ws="kaveri-cbe"]').click();
    cy.get('[data-testid="ws-switcher"]:visible', { timeout: 30000 }).first().should("contain.text", "Coimbatore");
  });
});
