// Suspended is a tenant-level status (src/app/admin/_components/actions.ts setTenantStatus), not a subscription field, so
// there is no demo lever for it: the demo setTenantStatus branch only reports what it "would" do and never mutates the
// fixture tenants (src/lib/demo/tenancy-fixture.ts always ships status "active"/"trial"). This needs a real session and a
// real super admin, so it runs on staging only: CYPRESS_REAL_SUPER_EMAIL/_PASSWORD plus a disposable tenant slug
// (CYPRESS_QA_SUSPEND_TENANT_SLUG) that is safe to suspend and reactivate. The owner side reuses the existing
// CYPRESS_QA_OWNER_EMAIL/_PASSWORD member of that same tenant (see cypress/e2e/settings/_helpers.ts).
import { creds } from "../settings/_helpers";

const superEmail = Cypress.expose("REAL_SUPER_EMAIL") as string | undefined;
const superPassword = Cypress.expose("REAL_SUPER_PASSWORD") as string | undefined;
const slug = (Cypress.expose("QA_SUSPEND_TENANT_SLUG") as string | undefined) ?? "";
const owner = creds("OWNER");
const real = !!superEmail && !!superPassword && !!slug && !!owner.email && !!owner.password;

(real ? describe : describe.skip)("billing: suspended tenant is read-only", () => {
  after(() => {
    cy.loginReal({ email: superEmail!, password: superPassword! });
    cy.visit(`/admin/tenants/${slug}`);
    cy.contains("button", "Reactivate tenant").click();
    cy.get("[role=dialog] input[name=confirm]").type(slug);
    cy.get("[role=dialog]").contains("button", "Reactivate").click();
  });

  it("suspending the tenant shows the owner the suspended banner on billing", () => {
    cy.loginReal({ email: superEmail!, password: superPassword! });
    cy.visit(`/admin/tenants/${slug}`);
    cy.contains("button", "Suspend tenant").click();
    cy.get("[role=dialog] input[name=confirm]").type(slug);
    cy.get("[role=dialog]").contains("button", "Suspend tenant").click();
    cy.contains(/suspended/i).should("be.visible");

    cy.loginReal({ email: owner.email!, password: owner.password! });
    cy.visit("/settings/billing", { failOnStatusCode: false });
    cy.get('[role="alert"]').should("contain.text", "This organisation is suspended. Everything is read-only. Contact support to restore it.");
  });
});
