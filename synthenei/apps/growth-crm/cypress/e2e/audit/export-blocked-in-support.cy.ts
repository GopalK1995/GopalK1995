// Export is blocked while a support session is open. Needs a real super user and a workspace to open the session in, so it
// runs on staging only (CYPRESS_REAL_SUPER_EMAIL / CYPRESS_REAL_SUPER_PASSWORD).
const superEmail = process.env.CYPRESS_REAL_SUPER_EMAIL, superPassword = process.env.CYPRESS_REAL_SUPER_PASSWORD;
const real = !!superEmail && !!superPassword;
(real ? describe : describe.skip)("audit: export blocked in support", () => {
  it("disables the export button with a reason inside a support session", () => {
    cy.loginReal({ email: superEmail!, password: superPassword! });
    cy.visit("/admin/support");
    cy.get("textarea[name=reason]").type("Ticket 142: verify audit export is blocked");
    cy.contains("button", "Start session and open workspace").click();
    cy.location("pathname", { timeout: 60000 }).should("eq", "/");
    cy.visit("/settings/audit");
    cy.get("[data-testid=audit-export]").should("have.attr", "aria-disabled", "true");
    cy.visit("/admin/support");
    cy.contains("button", "End now").click();
  });
});
