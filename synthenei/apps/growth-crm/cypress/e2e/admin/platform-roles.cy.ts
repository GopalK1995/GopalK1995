// Platform roles. The demo super admin holds every permission. Restricted roles need seeded staging users:
// CYPRESS_REAL_SUPPORT_EMAIL/_PASSWORD (role support) and CYPRESS_REAL_BILLING_EMAIL/_PASSWORD (role billing).
describe("admin: platform roles", () => {
  it("super admin can edit the policy and the connector matrix", () => {
    cy.loginAs("super");
    cy.visit("/admin/tenants/lawsome");
    cy.contains("[role=tab]", "Org-admin policy").click();
    cy.contains("button", "Save policy").should("be.enabled");
  });
  it("a tenant user cannot open the console", () => {
    cy.loginAs("owner-lawsome");
    cy.visit("/admin/tenants", { failOnStatusCode: false });
    cy.location("pathname").should("not.eq", "/admin/tenants");
  });
  const support = { email: String(Cypress.expose("REAL_SUPPORT_EMAIL") ?? ""), password: String(Cypress.expose("REAL_SUPPORT_PASSWORD") ?? "") };
  (support.email ? it : it.skip)("support role: policy editor is read only, no Suspend", () => {
    cy.loginReal(support);
    cy.visit("/admin/tenants");
    cy.contains("a", "Open").first().click();
    cy.contains("[role=tab]", "Org-admin policy").click();
    cy.contains("Read only for your role").should("be.visible");
    cy.contains("button", "Save policy").should("be.disabled");
    cy.contains("button", "Suspend tenant").should("be.disabled");
  });
  const billing = { email: String(Cypress.expose("REAL_BILLING_EMAIL") ?? ""), password: String(Cypress.expose("REAL_BILLING_PASSWORD") ?? "") };
  (billing.email ? it : it.skip)("billing role: tenant data is hidden", () => {
    cy.loginReal(billing);
    cy.visit("/admin/tenants");
    cy.contains("billing only").should("be.visible");
  });
});
