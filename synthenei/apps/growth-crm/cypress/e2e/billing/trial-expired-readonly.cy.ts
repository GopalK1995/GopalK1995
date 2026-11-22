// Trial expiry: the platform admin backdates trialEndsAt on /admin/billing, the owner sees the read-only banner on
// /settings/billing, and billing itself stays reachable (org_readonly is let through for billing.manage, src/app/(app)/settings/billing/actions.ts,
// so the owner can still pay their way out). The authz-level write block for every other permission is covered by
// src/lib/billing/__tests__/state.test.ts (orgState, applyBilling) and the authz matrix suite (its trial_expired fixture).
import { editLawsomeSubscription, isoDate, resetLawsomeSubscription } from "./_helpers";

describe("billing: trial expired is read-only", () => {
  after(() => resetLawsomeSubscription());

  it("demo: a trial that ended yesterday is read-only everywhere, but the owner can still reach billing to pay", () => {
    cy.loginAs("super");
    editLawsomeSubscription({ status: "trial", trialEndsAt: isoDate(-1), reason: "cypress: trial ended yesterday" });
    cy.get("[data-testid=sub-lawsome]").contains("Read-only").should("be.visible");

    cy.loginAs("owner-lawsome");
    cy.visit("/settings/billing");
    cy.contains("Billing is for owners").should("not.exist"); // page itself stays reachable (org_readonly exception)
    cy.get('[role="alert"]').should("contain.text", "Your trial has ended. The workspace is read-only until you subscribe.");
  });

  it("demo: a trial ending within 3 days warns without going read-only", () => {
    cy.loginAs("super");
    editLawsomeSubscription({ status: "trial", trialEndsAt: isoDate(2), reason: "cypress: trial ending soon" });
    cy.get("[data-testid=sub-lawsome]").contains("Read-only").should("not.exist");

    cy.loginAs("owner-lawsome");
    cy.visit("/settings/billing");
    cy.get('[role="status"]').should("contain.text", "Your trial ends soon. Subscribe to keep writing.");
  });

  it("demo: a trial with days left shows neither warning nor banner", () => {
    cy.loginAs("super");
    editLawsomeSubscription({ status: "trial", trialEndsAt: isoDate(10), reason: "cypress: trial healthy" });
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/billing");
    cy.get('[role="alert"], [role="status"]').should("not.exist");
  });
});
