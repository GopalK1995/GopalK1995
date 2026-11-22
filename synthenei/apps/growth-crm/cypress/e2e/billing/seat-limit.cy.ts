// Seat cap: the platform admin sets purchased seats on /admin/billing, the owner sees the cap reflected on /settings/billing.
// Write-time enforcement (blocking an invite at the cap) is unit-tested in src/lib/billing/__tests__/state.test.ts
// (seatStatus, canAddSeat, applyBilling) and in the authz matrix suite; this spec covers the UI/admin path only.
import { editLawsomeSubscription, resetLawsomeSubscription } from "./_helpers";

describe("billing: seat limit", () => {
  after(() => resetLawsomeSubscription());

  it("demo: purchasing fewer seats than are in use shows the admin console at-limit badge and the owner seats-over warning", () => {
    cy.loginAs("super");
    // The demo lawsome tenant has 3 seats in use (src/lib/billing/demo.ts); setting the cap to 2 puts it over.
    editLawsomeSubscription({ seats: "2", reason: "cypress: seat-limit over" });
    cy.get("[data-testid=sub-lawsome]").should("contain.text", "3 / 2");

    cy.loginAs("owner-lawsome");
    cy.visit("/settings/billing");
    cy.get("[data-testid=billing-seats]").should("contain.text", "3 of 2 seats used");
    cy.get("[data-testid=billing-seats]").contains("You are over your seat limit").should("be.visible");
  });

  it("demo: purchasing exactly the seats in use shows the seats-full warning, not seats-over", () => {
    cy.loginAs("super");
    editLawsomeSubscription({ seats: "3", reason: "cypress: seat-limit exact" });
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/billing");
    cy.get("[data-testid=billing-seats]").should("contain.text", "3 of 3 seats used");
    cy.get("[data-testid=billing-seats]").contains("All seats are in use").should("be.visible");
    cy.get("[data-testid=billing-seats]").contains("over your seat limit").should("not.exist");
  });

  it("demo: clearing the purchased-seats override falls back to the plan limit, with room to spare", () => {
    cy.loginAs("super");
    editLawsomeSubscription({ seats: "", reason: "cypress: seat-limit cleared" });
    cy.loginAs("owner-lawsome");
    cy.visit("/settings/billing");
    // Trial plan limit is 5 seats (src/lib/billing/memory-store.ts); 3 used leaves room.
    cy.get("[data-testid=billing-seats]").should("contain.text", "3 of 5 seats used");
    cy.get("[data-testid=billing-seats]").contains("All seats are in use").should("not.exist");
  });
});
