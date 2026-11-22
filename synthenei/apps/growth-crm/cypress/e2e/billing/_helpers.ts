// Shared by the billing specs. The demo billing store is a per-process singleton (src/lib/billing/runtime.ts storeFor),
// so an edit made as the platform admin on /admin/billing is visible to the tenant owner on /settings/billing in the
// same server run. Every spec that mutates the shared lawsome subscription restores it in an `after` hook.
export const isoDate = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

export interface SubEdit { planId?: string; status?: string; seats?: string; trialEndsAt?: string; currentPeriodEnd?: string; reason: string }
/** Opens the Edit form for the lawsome row on /admin/billing and saves the given fields (blank clears a field). */
export function editLawsomeSubscription(fields: SubEdit): void {
  cy.visit("/admin/billing");
  cy.get("[data-testid=sub-lawsome]").contains("button", "Edit").click();
  cy.get("[data-testid=edit-subscription]").within(() => {
    if (fields.planId) cy.get("select[name=planId]").select(fields.planId);
    if (fields.status) cy.get("select[name=status]").select(fields.status);
    if (fields.seats !== undefined) cy.get("input[name=seats]").clear().type(fields.seats);
    if (fields.trialEndsAt !== undefined) cy.get("input[name=trialEndsAt]").then(($el) => { if (fields.trialEndsAt) cy.wrap($el).clear().type(fields.trialEndsAt); else cy.wrap($el).clear(); });
    if (fields.currentPeriodEnd !== undefined) cy.get("input[name=currentPeriodEnd]").then(($el) => { if (fields.currentPeriodEnd) cy.wrap($el).clear().type(fields.currentPeriodEnd); else cy.wrap($el).clear(); });
    cy.get("input[name=reason]").clear().type(fields.reason);
    cy.contains("button", "Save subscription").click();
  });
  cy.contains("Subscription saved.").should("be.visible");
}
/** Puts the shared demo lawsome subscription back to a fresh, unexpired trial so later specs see a clean slate. */
export function resetLawsomeSubscription(): void {
  cy.loginAs("super");
  editLawsomeSubscription({ planId: "trial", status: "trial", seats: "", trialEndsAt: isoDate(14), currentPeriodEnd: "", reason: "cypress: reset after billing spec" });
}
